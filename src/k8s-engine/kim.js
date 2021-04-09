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

class Kim extends EventEmitter {
  start() {
    this.refreshImages();
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
        console.log(`kim images: ${ result.stderr } `);
      }
      this.emit('images-changed', this.parse(result.stdout));
    } catch (err) {
      console.log(err);
    }
  }

  refreshImages() {
    this.refreshInterval = setInterval(this.doRefreshImages.bind(this), 50 * 1000);
  }
}

exports.Kim = Kim;
