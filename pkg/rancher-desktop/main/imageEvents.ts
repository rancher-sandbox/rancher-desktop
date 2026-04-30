/**
 * This module contains code for handling image-processor events (containerd/nerdctl, moby/docker).
 */

import path from 'path';

import Electron from 'electron';

import { ImageProcessor, ImageType } from '@pkg/backend/images/imageProcessor';
import { getIpcMainProxy } from '@pkg/main/ipcMain';
import { isUnixError } from '@pkg/typings/unix.interface';
import Logging from '@pkg/utils/logging';
import * as window from '@pkg/window';

const console = Logging.images;
const ipcMainProxy = getIpcMainProxy(console);

// Map image-related events to the associated image processor's methods
// TODO: export the factory function to make this a singleton
/**
 * The ImageEventHandler is a singleton.
 * It points to an active ImageProcessor, and relays relevant events to that processor.
 * Having image processors handle their own events is messy (see the notion of activating
 * an image processor), and shouldn't handle any of them.
 */

export class ImageEventHandler {
  imageProcessor: ImageProcessor;
  #lastBuildDirectory = '';
  #mountCount = 0;

  constructor(imageProcessor: ImageProcessor) {
    this.imageProcessor = imageProcessor;
    this.initEventHandlers();
  }

  protected onImagesChanged(images: ImageType[]) {
    window.send('images-changed', images);
  }

  protected initEventHandlers() {
    ipcMainProxy.handle('images-mounted', (_, mounted) => {
      this.#mountCount += mounted ? 1 : -1;
      if (this.#mountCount < 1) {
        this.imageProcessor.removeListener('images-changed', this.onImagesChanged);
      } else if (this.#mountCount === 1) {
        this.imageProcessor.on('images-changed', this.onImagesChanged);
      }

      return this.imageProcessor.listImages();
    });

    ipcMainProxy.on('do-image-deletion', async(event, imageName, imageID) => {
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

    ipcMainProxy.on('do-image-deletion-batch', async(event, imageIDs) => {
      try {
        const uniqueImageIDs = new Set<string>(imageIDs);

        await this.imageProcessor.deleteImages([...uniqueImageIDs]);
        await this.imageProcessor.refreshImages();
        event.reply('images-process-ended', 0);
      } catch (err) {
        await Electron.dialog.showMessageBox({
          message: `Error trying to delete images ${ imageIDs }`,
          type:    'error',
        });
        event.reply('images-process-ended', 1);
      }
    });

    ipcMainProxy.on('do-image-build', async(event, taggedImageName) => {
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

    ipcMainProxy.on('do-image-pull', async(event, imageName) => {
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

    ipcMainProxy.on('do-image-scan', async(event, imageName, namespace) => {
      let taggedImageName = imageName;
      let code;

      // The containerd scanner only supports image names that include the registry name
      if (!taggedImageName.includes('/')) {
        taggedImageName = `library/${ imageName }`;
      }
      if (!taggedImageName.split('/')[0].includes('.')) {
        taggedImageName = `docker.io/${ taggedImageName }`;
      }
      if (!taggedImageName.includes(':')) {
        taggedImageName += ':latest';
      }

      try {
        code = (await this.imageProcessor.scanImage(taggedImageName, namespace)).code;
        await this.imageProcessor.refreshImages();
      } catch (err) {
        console.error(`Failed to scan image ${ imageName }: `, err);
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

    ipcMainProxy.on('do-image-push', async(event, imageName, imageID, tag) => {
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

    ipcMainProxy.handle('images-check-state', () => {
      return this.imageProcessor.isReady;
    });
  }
}
