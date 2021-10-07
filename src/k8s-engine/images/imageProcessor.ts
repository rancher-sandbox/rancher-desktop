import { Buffer } from 'buffer';
import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import os from 'os';
import timers from 'timers';

import * as K8s from '@/k8s-engine/k8s';
import mainEvents from '@/main/mainEvents';
import Logging from '@/utils/logging';
import LimaBackend from '@/k8s-engine/lima';

const REFRESH_INTERVAL = 5 * 1000;
const APP_NAME = 'rancher-desktop';
const console = Logging.images;

/**
 * The fields that cover the results of a finished process.
 * Not all fields are set for every process.
 */
export interface childResultType {
  stdout: string;
  stderr: string;
  code: number;
  signal?: string;
}

/**
 * The fields for display in the images table
 */
export interface imageType {
  imageName: string,
  tag: string,
  imageID: string,
  size: string,
}

/**
 * Define all methods common to all ImageProcessor subclasses here.
 * Abstract methods need to be implemented in concrete subclasses.
 */
export abstract class ImageProcessor extends EventEmitter {
  protected k8sManager: K8s.KubernetesBackend|null;
  // Sometimes the `images` subcommand repeatedly fires the same error message.
  // Instead of logging it every time, keep track of the current error and give a count instead.
  private lastErrorMessage = '';
  private sameErrorMessageCount = 0;
  protected showedStderr = false;
  private refreshInterval: ReturnType<typeof timers.setInterval> | null = null;
  protected images:imageType[] = [];
  protected _isReady = false;
  private isK8sReady = false;
  private hasImageListeners = false;
  private isWatching = false;
  _refreshImages: () => Promise<void>;
  protected currentNamespace = 'default';

  constructor(k8sManager: K8s.KubernetesBackend) {
    super();
    this.k8sManager = k8sManager;
    this._refreshImages = this.refreshImages.bind(this);
    this.on('newListener', (event: string | symbol) => {
      if (event === 'images-changed' && !this.hasImageListeners) {
        this.hasImageListeners = true;
        this.updateWatchStatus();
      }
    });
    this.on('removeListener', (event: string | symbol) => {
      if (event === 'images-changed' && this.hasImageListeners) {
        this.hasImageListeners = this.listeners('images-changed').length > 0;
        this.updateWatchStatus();
      }
    });
    mainEvents.on('k8s-check-state', (mgr: K8s.KubernetesBackend) => {
      this.isK8sReady = [K8s.State.VM_STARTED, K8s.State.STARTED].includes(mgr.state);
      this.updateWatchStatus();
    });
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
   * @param taggedImageName
   */
  async scanImage(taggedImageName: string): Promise<childResultType> {
    return await this.runTrivyCommand(['image', '--no-progress', '--format', 'template',
      '--template', '@/var/lib/trivy.tpl', taggedImageName]);
  }

  /**
   * This method figures out which command to run for scanning, based on the platform
   * and provided args.
   * @param args
   * @param sendNotifications
   */
  async runTrivyCommand(args: string[], sendNotifications = true): Promise<childResultType> {
    let child: ChildProcess;
    const subcommandName = args[0];

    if (os.platform().startsWith('win')) {
      args = ['-d', APP_NAME, 'trivy'].concat(args);
      child = spawn('wsl', args);
    } else if (os.platform().startsWith('darwin') || os.platform().startsWith('linux')) {
      const limaBackend = this.k8sManager as LimaBackend;

      args = ['trivy'].concat(args);
      child = limaBackend.limaSpawn(args);
    } else {
      throw new Error(`Don't know how to run trivy on platform ${ os.platform() }`);
    }

    return await this.processChildOutput(child, subcommandName, sendNotifications);
  }

  /**
   * Returns the current list of cached images.
   */
  listImages(): imageType[] {
    return this.images;
  }

  /**
   * Refreshes the current cache of processed iamges.
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
        if (err.stderr && !err.stdout && !err.signal) {
          console.log(err.stderr);
        } else {
          console.log(err);
        }
      }
      this.showedStderr = true;
      if ('code' in err && this._isReady) {
        this._isReady = false;
        this.emit('readiness-changed', false);
      }
    }
  }

  protected parse(data: string): imageType[] {
    const results = data.trimEnd().split(/\r?\n/).slice(1).map((line) => {
      const [imageName, tag, imageID, size] = line.split(/\s+/);

      return {
        imageName, tag, imageID, size
      };
    });

    return results;
  }

  /**
   * Takes the `childProcess` returned by a command like `child_process.spawn` and processes the
   * output streams and exit code and signal.
   *
   * @param child
   * @param subcommandName - used for error messages only
   * @param sendNotifications
   */
  async processChildOutput(child: ChildProcess, subcommandName: string, sendNotifications: boolean): Promise<childResultType> {
    const result = { stdout: '', stderr: '' };

    return await new Promise((resolve, reject) => {
      child.stdout?.on('data', (data: Buffer) => {
        const dataString = data.toString();

        if (sendNotifications) {
          this.emit('images-process-output', dataString, false);
        }
        result.stdout += dataString;
      });
      child.stderr?.on('data', (data: Buffer) => {
        let dataString = data.toString();

        if (this.processorName === 'nerdctl' && subcommandName === 'images') {
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
        if (sendNotifications) {
          this.emit('images-process-output', dataString, true);
        }
      });
      child.on('exit', (code, signal) => {
        if (result.stderr) {
          const timeLessMessage = result.stderr.replace(/\btime=".*?"/g, '');

          if (this.lastErrorMessage !== timeLessMessage) {
            this.lastErrorMessage = timeLessMessage;
            this.sameErrorMessageCount = 1;
            console.log(result.stderr.replace(/(?!<\r)\n/g, '\r\n'));
          } else {
            const m = /(Error: .*)/.exec(this.lastErrorMessage);

            this.sameErrorMessageCount += 1;
            console.log(`${ this.processorName } ${ subcommandName }: ${ m ? m[1] : 'same error message' } #${ this.sameErrorMessageCount }\r`);
          }
        }
        if (code === 0) {
          resolve({ ...result, code });
        } else if (signal) {
          reject({
            ...result, code: -1, signal
          });
        } else {
          reject({ ...result, code });
        }
      });
    });
  }

  get namespace() {
    return this.currentNamespace;
  }

  set namespace(value: string) {
    this.currentNamespace = value;
  }

  /* Subclass-specific method definitions here: */

  protected abstract get processorName(): string;

  abstract getNamespaces(): Promise<Array<string>>;

  abstract buildImage(dirPart: string, filePart: string, taggedImageName: string): Promise<childResultType>;

  abstract deleteImage(imageID: string): Promise<childResultType>;

  abstract pullImage(taggedImageName: string): Promise<childResultType>;

  abstract pushImage(taggedImageName: string): Promise<childResultType>;

  abstract getImages(): Promise<childResultType>;
}
