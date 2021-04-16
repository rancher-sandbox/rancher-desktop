'use strict';

// This file should probably be an instance of ImageManager < EventEmitter.
// We'll get there eventually

const { EventEmitter } = require('events');
const process = require('process');
const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const util = require('util');
const paths = require('xdg-app-paths')({ name: 'rancher-desktop' });
const resources = require('../resources');
const K8s = require('./k8s');

const REFRESH_INTERVAL = 5 * 1000;

export default class Kim extends EventEmitter {
  constructor() {
    super();
    this.showedStderr = false;
    this.refreshInterval = null;
    this.currentCommand = null;
  }

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

  async runCommand(args, sendNotifications = true) {
    const child = spawn(resources.executable('kim'), args);
    const result = {
      stdout: '', stderr: '', code: null
    };

    this.currentCommand = `${ resources.executable('kim') } ${ args.join(' ') }`;

    return await new Promise((resolve, reject) => {
      child.stdout.on('data', (data) => {
        const dstring = data.toString();

        if (sendNotifications) {
          this.emit('kim-process-output', dstring, false);
        }
        result.stdout += dstring;
      });
      child.stderr.on('data', (data) => {
        const dstring = data.toString();

        console.log(dstring);
        result.stderr += dstring;
        if (sendNotifications) {
          this.emit('kim-process-output', dstring, true);
        }
      });
      child.on('exit', (code, sig) => {
        result.code = code;
        if (code === 0) {
          resolve(result);
        } else if (sig !== undefined) {
          reject({ ...result, signal: sig });
        } else {
          reject(result);
        }
        this.currentCommand = null;
      });
    });
  }

  async buildImage(dirPart, filePart, taggedImageName) {
    const args = ['build'];

    args.push('--file');
    args.push(filePart);
    args.push('--tag');
    args.push(taggedImageName);
    args.push(dirPart);

    return await this.runCommand(args);
  }

  async deleteImage(imageID) {
    return await this.runCommand(['rmi', imageID]);
  }

  async pullImage(taggedImageName) {
    return await this.runCommand(['pull', taggedImageName, '--debug']);
  }

  async pushImage(taggedImageName) {
    return await this.runCommand(['push', taggedImageName, '--debug']);
  }

  async getImages() {
    return await this.runCommand(['images', '--all'], false);
  }

  parse(data) {
    const results = data.trimEnd().split(/\r?\n/).slice(1).map((line) => {
      const [imageName, tag, imageID, size] = line.split(/\s+/);

      return {
        imageName, tag, imageID, size
      };
    });

    return results;
  }

  async refreshImages() {
    try {
      const result = await this.getImages();

      if (result.stderr) {
        if (!this.showedStderr) {
          console.log(`kim images: ${ result.stderr } `);
          this.showedStderr = true;
        }
      } else {
        this.showedStderr = false;
      }
      this.emit('images-changed', this.parse(result.stdout));
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
