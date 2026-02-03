import { Buffer } from 'buffer';
import { EventEmitter } from 'events';
import timers from 'timers';

import { VMBackend, VMExecutor } from '@pkg/backend/backend';
import mainEvents from '@pkg/main/mainEvents';
import { ChildProcess, ErrorCommand } from '@pkg/utils/childProcess';
import Logging from '@pkg/utils/logging';
import * as window from '@pkg/window';

const REFRESH_INTERVAL = 5 * 1000;
const console = Logging.images;

/**
 * The fields that cover the results of a finished process.
 * Not all fields are set for every process.
 */
export interface childResultType {
  stdout:  string;
  stderr:  string;
  code:    number;
  signal?: string;
}

/**
 * The fields for display in the images table
 */
export interface ImageType {
  imageName: string;
  tag:       string;
  imageID:   string;
  size:      string;
  digest:    string;
}

/**
 * Options for `processChildOutput`.
 */
interface ProcessChildOutputOptions {
  /** The name of the executable; defaults to `processorName`. */
  commandName?:   string;
  /** The sub-command being executed; typically the first argument. */
  subcommandName: string;
  /** What notifications to send. */
  notifications?: {
    /** Send stdout as it comes in via `image-process-output`. */
    stdout?: boolean;
    /** Send stderr as it comes in via `image-process-output`. */
    stderr?: boolean;
    /** Send stdout after the command succeeds to the window via `ok:images-process-output`. */
    ok?:     boolean;
  }
}

/**
 * ImageProcessors take requests, from the UI or caused by state transitions
 * (such as a K8s engine hitting the STARTED state), and invokes the appropriate
 * client to run commands and send output to the UI.
 *
 * Each concrete ImageProcessor is a singleton, with a 1:1 correspondence between
 * the current container engine the user has selected, and its ImageProcessor.
 *
 * Currently, some events are handled directly by the concrete ImageProcessor subclasses,
 * and some are handled by the ImageEventHandler singleton, which calls methods on
 * the current ImageProcessor. Because these events are sent to all imageProcessors, but
 * only one should actually act on them, we use the concept of the `active` processor
 * to determine which processor acts on its events.
 *
 * When all the event-handlers have been moved into the ImageEventHandler the concept of
 * an active ImageProcessor can be dropped.
 */
export abstract class ImageProcessor extends EventEmitter {
  protected backend:       VMBackend;
  // Sometimes the `images` subcommand repeatedly fires the same error message.
  // Instead of logging it every time, keep track of the current error and give a count instead.
  private lastErrorMessage = '';
  private sameErrorMessageCount = 0;
  protected showedStderr = false;
  private refreshInterval: ReturnType<typeof timers.setInterval> | null = null;
  protected images:        ImageType[] = [];
  protected _isReady = false;
  protected isK8sReady = false;
  private hasImageListeners = false;
  private isWatching = false;
  _refreshImages:          () => Promise<void>;
  protected currentNamespace = 'default';
  // See https://github.com/rancher-sandbox/rancher-desktop/issues/977
  // for a task to get rid of the concept of an active imageProcessor.
  // All the event handlers should be on the imageEventHandler, which knows
  // which imageProcessor is currently active, and it can direct events to that.
  protected active = false;

  protected constructor(backend: VMBackend) {
    super();
    this.backend = backend;
    this._refreshImages = this.refreshImages.bind(this);
    this.on('newListener', (event: string | symbol) => {
      if (!this.active) {
        return;
      }
      if (event === 'images-changed' && !this.hasImageListeners) {
        this.hasImageListeners = true;
        this.updateWatchStatus();
      }
    });
    this.on('removeListener', (event: string | symbol) => {
      if (!this.active) {
        return;
      }
      if (event === 'images-changed' && this.hasImageListeners) {
        this.hasImageListeners = this.listeners('images-changed').length > 0;
        this.updateWatchStatus();
      }
    });
    this.on('readiness-changed', (state: boolean) => {
      if (!this.active) {
        return;
      }
      window.send('images-check-state', state);
    });
    this.on('images-process-output', (data: string, isStderr: boolean) => {
      if (!this.active) {
        return;
      }
      window.send('images-process-output', data, isStderr);
    });
    mainEvents.on('settings-update', (cfg) => {
      if (!this.active) {
        return;
      }

      if (this.namespace !== cfg.images.namespace) {
        this.namespace = cfg.images.namespace;
        this.refreshImages()
          .catch((err: Error) => {
            console.log(`Error refreshing images:`, err);
          });
      }
    });
  }

  activate() {
    this.active = true;
  }

  deactivate() {
    this.active = false;
  }

  protected updateWatchStatus() {
    const shouldWatch = this.isK8sReady && this.hasImageListeners;

    if (this.isWatching === shouldWatch) {
      return;
    }

    if (this.refreshInterval) {
      timers.clearInterval(this.refreshInterval);
    }
    if (shouldWatch) {
      this.refreshInterval = timers.setInterval(this._refreshImages, REFRESH_INTERVAL);
      timers.setImmediate(this._refreshImages);
    }
    this.isWatching = shouldWatch;
  }

  /**
   * Are images ready for display in the UI?
   */
  get isReady() {
    return this._isReady;
  }

  /**
   * Wrapper around the trivy command to scan the specified image.
   * @param taggedImageName The name of the image, e.g. `registry.opensuse.org/opensuse/leap:15.6`.
   * @param namespace The namespace to scan.
   */
  abstract scanImage(taggedImageName: string, namespace: string): Promise<childResultType>;

  /**
   * Scan an image using trivy.
   * @param taggedImageName The image to scan, e.g. `registry.opensuse.org/opensuse/leap:15.6`.
   * @param env Extra environment variables to set, e.g. `CONTAINERD_NAMESPACE`.
   */
  async runTrivyScan(taggedImageName: string, env?: Record<string, string>) {
    const imageSrc = {
      docker:  'docker',
      nerdctl: 'containerd',
    }[this.processorName] ?? this.processorName;
    const args = ['trivy', '--quiet', 'image', '--image-src', imageSrc, '--format', 'json', taggedImageName];

    if (env) {
      args.unshift('/usr/bin/env', ...Object.entries(env).map(([k, v]) => `${ k }=${ v }`));
    }

    return await this.processChildOutput(
      this.backend.executor.spawn({ root: true }, ...args),
      {
        commandName:    'trivy',
        subcommandName: 'image',
        // Do not set stdout to avoid dumping JSON that nobody ever reads.
        notifications:  { stderr: true, ok: true },
      },
    );
  }

  /**
   * Returns the current list of cached images.
   */
  listImages(): ImageType[] {
    return this.images;
  }

  isChildResultType(object: any): object is childResultType {
    return 'stderr' in object &&
      'stdout' in object &&
      'signal' in object &&
      'code' in object;
  }

  /**
   * Refreshes the current cache of processed images.
   */
  async refreshImages() {
    try {
      const result:childResultType = await this.getImages();

      if (result.stderr) {
        if (!this.showedStderr) {
          console.log(`${ this.processorName } images: ${ result.stderr } `);
          this.showedStderr = true;
        }
      } else {
        this.showedStderr = false;
      }
      this.images = this.parse(result.stdout);
      if (!this._isReady) {
        this._isReady = true;
        this.emit('readiness-changed', true);
      }
      this.emit('images-changed', this.images);
    } catch (err) {
      if (!this.showedStderr) {
        if (this.isChildResultType(err) && !err.stdout && !err.signal) {
          console.log(err.stderr);
        } else {
          console.log(err);
        }
      }
      this.showedStderr = true;
      if (this.isChildResultType(err) && this._isReady) {
        this._isReady = false;
        this.emit('readiness-changed', false);
      }
    }
  }

  protected parse(data: string): ImageType[] {
    const results = data
      .trimEnd()
      .split(/\r?\n/)
      .slice(1)
      .map((line) => {
        const [imageName, tag, digest, imageID, _created, _platform, size, _blobSize] = line.split(/\s+/);

        return {
          imageName, tag, imageID, size, digest,
        };
      });

    return results;
  }

  /**
   * Takes the `childProcess` returned by a command like `child_process.spawn` and processes the
   * output streams and exit code and signal.
   *
   * @param child The child process to monitor.
   * @param options Additional options.
   */
  async processChildOutput(child: ChildProcess, options: ProcessChildOutputOptions): Promise<childResultType> {
    const { subcommandName } = options;
    const result = { stdout: '', stderr: '' };
    const commandName = options.commandName ?? this.processorName;
    const command = `${ commandName } ${ subcommandName }`;
    const sendNotifications = options.notifications ?? {
      stdout: true, stderr: true, ok: true,
    };

    return await new Promise((resolve, reject) => {
      child.stdout?.on('data', (data: Buffer) => {
        const dataString = data.toString();

        if (sendNotifications.stdout) {
          this.emit('images-process-output', dataString, false);
        }
        result.stdout += dataString;
      });
      child.stderr?.on('data', (data: Buffer) => {
        let dataString = data.toString();

        if (commandName === 'nerdctl' && subcommandName === 'images') {
          /**
           * `nerdctl images` issues some dubious error messages
           *  (see https://github.com/containerd/nerdctl/issues/353 , logged 2021-09-10)
           *  Pull them out for now
           */
          dataString = dataString
            .replace(/time=".+?"\s+level=.+?\s+msg="failed to compute image\(s\) size"\s*/g, '')
            .replace(/time=".+?"\s+level=.+?\s+msg="unparsable image name.*?sha256:[0-9a-fA-F]{64}.*?\\""\s*/g, '');
          if (!dataString) {
            return;
          }
        }
        result.stderr += dataString;
        if (sendNotifications.stderr) {
          this.emit('images-process-output', dataString, true);
        }
      });
      child.on('exit', (code, signal) => {
        if (result.stderr) {
          const timeLessMessage = result.stderr.replace(/\btime=".*?"/g, '');

          if (this.lastErrorMessage !== timeLessMessage) {
            this.lastErrorMessage = timeLessMessage;
            this.sameErrorMessageCount = 1;

            console.log(`> ${ command }:\r\n${ result.stderr.replace(/(?!<\r)\n/g, '\r\n') }`);
          } else {
            const m = /(Error: .*)/.exec(this.lastErrorMessage);

            this.sameErrorMessageCount += 1;
            console.log(`${ command }: ${ m ? m[1] : 'same error message' } #${ this.sameErrorMessageCount }\r`);
          }
        } else if (commandName === 'trivy') {
          console.log(`> ${ command }: returned ${ result.stdout.length } bytes on stdout`);
        } else {
          console.log(`> ${ command }:\n${ result.stdout.replace(/(?!<\r)\n/g, '\r\n') }`);
        }
        if (code === 0) {
          if (sendNotifications.ok) {
            window.send('ok:images-process-output', result.stdout);
          }
          resolve({ ...result, code });
        } else if (signal) {
          reject(Object.create(result, {
            code:           { value: -1 },
            signal:         { value: signal },
            [ErrorCommand]: {
              enumerable: false,
              value:      child.spawnargs,
            },
          }));
        } else {
          reject(Object.create(result, {
            code:           { value: code },
            [ErrorCommand]: {
              enumerable: false,
              value:      child.spawnargs,
            },
          }));
        }
      });
    });
  }

  /**
   * Called normally when the UI requests the current list of namespaces
   * for the current imageProcessor.
   *
   * containerd starts with two namespaces: "k8s.io" and "default".
   * There's no way to add other namespaces in the UI,
   * but they can easily be added from the command-line.
   *
   * See https://github.com/rancher-sandbox/rancher-desktop/issues/978 for being notified
   * without polling on changes in the namespaces.
   */
  async relayNamespaces() {
    const namespaces = await this.getNamespaces();
    const comparator = Intl.Collator(undefined, { sensitivity: 'base' }).compare;

    if (!namespaces.includes('default')) {
      namespaces.push('default');
    }
    window.send('images-namespaces', namespaces.sort(comparator));
  }

  get namespace() {
    return this.currentNamespace;
  }

  set namespace(value: string) {
    this.currentNamespace = value;
  }

  /* Subclass-specific method definitions here: */

  protected abstract get processorName(): string;

  abstract getNamespaces(): Promise<string[]>;

  abstract buildImage(dirPart: string, filePart: string, taggedImageName: string): Promise<childResultType>;

  abstract deleteImage(imageID: string): Promise<childResultType>;

  abstract deleteImages(imageIDs: string[]): Promise<childResultType>;

  abstract pullImage(taggedImageName: string): Promise<childResultType>;

  abstract pushImage(taggedImageName: string): Promise<childResultType>;

  abstract getImages(): Promise<childResultType>;
}
