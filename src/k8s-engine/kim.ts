const { EventEmitter } = require('events');
const process = require('process');
const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const util = require('util');
const paths = require('xdg-app-paths')({ name: 'rancher-desktop' });
const resources = require('../resources');

const REFRESH_INTERVAL = 5 * 1000;

interface childResultType {
  stdout: string,
  stderr: string,
  code: number
}

interface imageType {
  imageName: string,
  tag: string,
  imageID: string,
  size: string,
}

export default class Kim extends EventEmitter {
  private showedStderr = false;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private currentCommand: string | null = null;
  private lastErrorMessage = '';
  private sameErrorMessageCount = 0;
  private images: imageType[] = [];

  start() {
    this.stop();
    this.refreshInterval = setInterval(this.refreshImages.bind(this), REFRESH_INTERVAL);
  }

  stop() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  async runCommand(args: string[], sendNotifications = true): Promise<childResultType> {
    const child = spawn(resources.executable('kim'), args);
    const result: childResultType = {
      stdout: '', stderr: '', code: 0
    };

    this.currentCommand = `${ resources.executable('kim') } ${ args.join(' ') }`;

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
      child.on('exit', (code: number, sig: string) => {
        if (result.stderr) {
          const timeLessMessage = result.stderr.replace(/\btime=".*?"/g, '');

          if (this.lastErrorMessage !== timeLessMessage) {
            this.lastErrorMessage = timeLessMessage;
            this.sameErrorMessageCount = 1;
            console.log(result.stderr.replace(/([^\r])\n/g, '$1\r\n'));
          } else {
            const m = /(Error: .*)/.exec(this.lastErrorMessage);

            this.sameErrorMessageCount += 1;
            console.log(`kim ${ args[0] }: ${ m ? m[1] : 'same error message' } #${ this.sameErrorMessageCount }\r`);
          }
        }
        result.code = code;
        if (code === 0) {
          resolve(result);
        } else if (sig) {
          reject({ ...result, signal: sig });
        } else {
          reject(result);
        }
        this.currentCommand = null;
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
    }
  }
}
