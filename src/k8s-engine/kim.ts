import { spawn } from 'child_process';
import { Console } from 'console';
import { EventEmitter } from 'events';
import path from 'path';
import timers from 'timers';

import * as K8s from '@/k8s-engine/k8s';
import mainEvents from '@/main/mainEvents';
import Logging from '@/utils/logging';
import resources from '@/resources';

const REFRESH_INTERVAL = 5 * 1000;

const console = new Console(Logging.kim.stream);

interface childResultType {
  stdout: string;
  stderr: string;
  code: number;
  signal?: string;
}

interface imageType {
  imageName: string,
  tag: string,
  imageID: string,
  size: string,
}

interface Kim extends EventEmitter {
  /**
   * Emitted when the images are different.  Note that we will only refresh the
   * image list when listeners are registered for this event.
   */
  on(event: 'images-changed', listener: (images: imageType[]) => void): this;

  /**
   * Emitted when command output is received.
   */
  on(event: 'kim-process-output', listener: (data: string, isStderr: boolean) => void): this;

  /**
   * Emitted when the Kim backend readiness has changed.
   */
  on(event: 'readiness-changed', listener: (isReady: boolean) => void): this;

  // Inherited, for internal handling.
  on(event: 'newListener', listener: (eventName: string | symbol, listener: (...args: any[]) => void) => void): this;
  on(event: 'removeListener', listener: (eventName: string | symbol, listener: (...args: any[]) => void) => void): this;
}

class Kim extends EventEmitter {
  private showedStderr = false;
  private refreshInterval: ReturnType<typeof timers.setInterval> | null = null;
  // During startup `kim images` repeatedly fires the same error message. Instead,
  // keep track of the current error and give a count instead.
  private lastErrorMessage = '';
  private sameErrorMessageCount = 0;
  private images: imageType[] = [];
  private _isReady = false;
  private isK8sReady = false;
  private hasImageListeners = false;
  private isWatching = false;

  constructor() {
    super();
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
      this.isK8sReady = mgr.state === K8s.State.STARTED;
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
    }
    this.isWatching = shouldWatch;
  }

  get isReady() {
    return this._isReady;
  }

  async runCommand(args: string[], sendNotifications = true): Promise<childResultType> {
    const child = spawn(resources.executable('kim'), args);
    const result = { stdout: '', stderr: '' };

    return await new Promise((resolve, reject) => {
      child.stdout.on('data', (data: Buffer) => {
        const dataString = data.toString();

        if (sendNotifications) {
          this.emit('kim-process-output', dataString, false);
        }
        result.stdout += dataString;
      });
      child.stderr.on('data', (data: Buffer) => {
        const dataString = data.toString();

        result.stderr += dataString;
        if (sendNotifications) {
          this.emit('kim-process-output', dataString, true);
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
            console.log(`kim ${ args[0] }: ${ m ? m[1] : 'same error message' } #${ this.sameErrorMessageCount }\r`);
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

  async buildImage(dirPart: string, filePart: string, taggedImageName: string): Promise<childResultType> {
    const args = ['build'];

    args.push('--file');
    args.push(path.join(dirPart, filePart));
    args.push('--tag');
    args.push(taggedImageName);
    args.push(dirPart);

    return await this.runCommand(args);
  }

  async deleteImage(imageID: string): Promise<childResultType> {
    return await this.runCommand(['rmi', imageID]);
  }

  async pullImage(taggedImageName: string): Promise<childResultType> {
    return await this.runCommand(['pull', taggedImageName, '--debug']);
  }

  async pushImage(taggedImageName: string): Promise<childResultType> {
    return await this.runCommand(['push', taggedImageName, '--debug']);
  }

  async getImages(): Promise<childResultType> {
    return await this.runCommand(['images', '--all'], false);
  }

  parse(data: string): imageType[] {
    const results = data.trimEnd().split(/\r?\n/).slice(1).map((line) => {
      const [imageName, tag, imageID, size] = line.split(/\s+/);

      return {
        imageName, tag, imageID, size
      };
    });

    return results;
  }

  listImages(): imageType[] {
    return this.images;
  }

  async refreshImages() {
    try {
      const result: childResultType = await this.getImages();

      if (result.stderr) {
        if (!this.showedStderr) {
          console.log(`kim images: ${ result.stderr } `);
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

  _refreshImages: () => Promise<void>;
}

export default Kim;
