/**
 * This module contains code for handling image-processor events (containerd/nerdctl, moby/docker).
 */

import path from 'path';

import Electron from 'electron';
import Logging from '@/utils/logging';
import * as window from '@/window';

import { ImageProcessor } from '@/k8s-engine/images/imageProcessor';
import { isUnixError } from '@/typings/unix.interface';

const console = Logging.images;

interface ImageContents {
  imageName: string,
  tag: string,
  imageID: string,
  size: string
}

// Map image-related events to the associated image processor's methods
// TODO: export the factory function to make this a singleton
/**
 * The ImageEventHandler is a singleton.
 * It points to an active ImageProcessor, and relays relevant events to that processor.
 * Having image processors handle their own events is messy (see the notion of activating
 * an image processor), and shouldn't handle any of them.
 */

export class ImageEventHandler {
  imageProcessor: ImageProcessor
  #lastBuildDirectory = '';
  #mountCount = 0;

  constructor(imageProcessor: ImageProcessor) {
    this.imageProcessor = imageProcessor;
    this.initEventHandlers();
  }

  protected onImagesChanged(images: ImageContents[]) {
    window.send('images-changed', images);
  }

  protected initEventHandlers() {
    Electron.ipcMain.handle('images-mounted', (_, mounted) => {
      this.#mountCount += mounted ? 1 : -1;
      if (this.#mountCount < 1) {
        this.imageProcessor.removeListener('images-changed', this.onImagesChanged);
      } else if (this.#mountCount === 1) {
        this.imageProcessor.on('images-changed', this.onImagesChanged);
      }

      return this.imageProcessor.listImages();
    });

    Electron.ipcMain.on('do-image-deletion', async(event, imageName, imageID) => {
      try {
        await this.imageProcessor.deleteImage(imageID);
        await this.imageProcessor.refreshImages();
        event.reply('images-process-ended', 0);
      } catch (err) {
        await Electron.dialog.showMessageBox({
          message: `Error trying to delete image ${ imageName } (${ imageID }):\n\n ${ isUnixError(err) ? err.stderr : '' } `,
          type:    'error',
        });
        event.reply('images-process-ended', 1);
      }
    });

    Electron.ipcMain.on('do-image-build', async(event, taggedImageName) => {
      const options: any = {
        title:      'Pick the build directory',
        properties: ['openFile'],
        message:    'Please select the Dockerfile to use (could have a different name)',
      };

      if (this.#lastBuildDirectory) {
        options.defaultPath = this.#lastBuildDirectory;
      }
      const results = Electron.dialog.showOpenDialogSync(options);

      if (results === undefined) {
        event.reply('images-process-cancelled');

        return;
      }
      if (results.length !== 1) {
        console.log(`Expecting exactly one result, got ${ results.join(', ') }`);
        event.reply('images-process-cancelled');

        return;
      }
      const pathParts = path.parse(results[0]);
      let code;

      this.#lastBuildDirectory = pathParts.dir;
      try {
        code = (await this.imageProcessor.buildImage(this.#lastBuildDirectory, pathParts.base, taggedImageName)).code;
        await this.imageProcessor.refreshImages();
      } catch (err) {
        if (isUnixError(err)) {
          code = err.code;
        }
      }
      event.reply('images-process-ended', code);
    });

    Electron.ipcMain.on('do-image-pull', async(event, imageName) => {
      let taggedImageName = imageName;
      let code;

      if (!imageName.includes(':')) {
        taggedImageName += ':latest';
      }
      try {
        code = (await this.imageProcessor.pullImage(taggedImageName)).code;
        await this.imageProcessor.refreshImages();
      } catch (err) {
        if (isUnixError(err)) {
          code = err.code;
        }
      }
      event.reply('images-process-ended', code);
    });

    Electron.ipcMain.on('do-image-scan', async(event, imageName) => {
      let taggedImageName = imageName;
      let code;

      if (!imageName.includes(':')) {
        taggedImageName += ':latest';
      }
      try {
        code = (await this.imageProcessor.scanImage(taggedImageName)).code;
        await this.imageProcessor.refreshImages();
      } catch (err) {
        if (isUnixError(err)) {
          code = err.code;
        }
        Electron.dialog.showMessageBox({
          message: `Error trying to scan ${ taggedImageName }:\n\n ${ isUnixError(err) ? err.stderr : '' } `,
          type:    'error',
        }).catch((err) => {
          console.log('messageBox failure: ', err);
        });
      }
      event.reply('images-process-ended', code);
    });

    Electron.ipcMain.on('do-image-push', async(event, imageName, imageID, tag) => {
      const taggedImageName = `${ imageName }:${ tag }`;
      let code;

      try {
        code = (await this.imageProcessor.pushImage(taggedImageName)).code;
      } catch (err) {
        if (isUnixError(err)) {
          code = err.code;
        }
        Electron.dialog.showMessageBox({
          message: `Error trying to push ${ taggedImageName }:\n\n ${ isUnixError(err) ? err.stderr : '' } `,
          type:    'error',
        }).catch((err) => {
          console.log('messageBox failure: ', err);
        });
      }
      event.reply('images-process-ended', code);
    });

    Electron.ipcMain.handle('images-check-state', () => {
      return this.imageProcessor.isReady;
    });
  }
}
