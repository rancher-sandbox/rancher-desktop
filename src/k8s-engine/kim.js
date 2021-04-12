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

class Kim extends EventEmitter {
  constructor() {
    super();
    this.notifiedMissingKim = false;
    this.showedStderr = false;
  }

  start() {
    fs.access(resources.executable('kim'),
      fs.constants.R_OK | fs.constants.X_OK,
      (err) => {
        if (err) {
          if (!this.notifiedMissingKim) {
            const dirname = path.dirname(resources.executable('kim'));

            console.log(`\nkim executable not found in ${ dirname }`);
            this.notifiedMissingKim = true;
          }
        } else {
          this.refreshImages();
        }
      });
  }

  stop() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  }

  async getImages() {
    const child = spawn(resources.executable('kim'), ['images']);
    const result = { stdout: '', stderr: '' };

    return await new Promise((resolve, reject) => {
      child.stdout.on('data', (data) => {
        result.stdout += data.toString();
      });
      child.stderr.on('data', (data) => {
        result.stderr += data.toString();
      });
      child.on('exit', (code, sig) => {
        if (code === 0) {
          resolve(result);
        } else if (sig !== undefined) {
          reject({ ...result, signal: sig });
        } else {
          reject(result);
        }
      });
    });
  }

  parse(data) {
    const results = data.trimEnd().split(/\r?\n/).slice(1).map((line) => {
      const parts = line.split(/\s+/);

      return {
        imageName: parts[0],
        tag:       parts[1],
        imageID:   parts[2],
        size:      parts[3]
      };
    });

    return results;
  }

  async doRefreshImages() {
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

  refreshImages() {
    this.refreshInterval = setInterval(this.doRefreshImages.bind(this), REFRESH_INTERVAL);
  }
}

exports.Kim = Kim;
