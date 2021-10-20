/**
 * This module contains code for handling image-processor events (nerdctl, kim).
 */

import path from 'path';

import Electron from 'electron';

import { ImageProcessor } from '@/k8s-engine/images/imageProcessor';
import { createImageProcessor, ImageProcessorName } from '@/k8s-engine/images/imageFactory';
import Logging from '@/utils/logging';
import * as window from '@/window';
import * as K8s from '@/k8s-engine/k8s';

const console = Logging.images;

let imageManager: ImageProcessor;
let lastBuildDirectory = '';
let mountCount = 0;

/**
 * Map image-related events to the associated image processor's methods
 * @param imageProcessorName
 * @param k8sManager
 */

export function setupImageProcessor(imageProcessorName: ImageProcessorName, k8sManager: K8s.KubernetesBackend): ImageProcessor {
  imageManager = imageManager ?? createImageProcessor(imageProcessorName, k8sManager);

  interface ImageContents {
    imageName: string,
    tag: string,
    imageID: string,
    size: string
  }
  imageManager.on('readiness-changed', (state: boolean) => {
    window.send('images-check-state', state);
  });
  imageManager.on('images-process-output', (data: string, isStderr: boolean) => {
    window.send('images-process-output', data, isStderr);
  });

  function onImagesChanged(images: ImageContents[]) {
    window.send('images-changed', images);
  }
  Electron.ipcMain.handle('images-mounted', (_, mounted) => {
    mountCount += mounted ? 1 : -1;
    if (mountCount < 1) {
      imageManager.removeListener('images-changed', onImagesChanged);
    } else if (mountCount === 1) {
      imageManager.on('images-changed', onImagesChanged);
    }

    return imageManager.listImages();
  });

  Electron.ipcMain.on('do-image-deletion', async(event, imageName, imageID) => {
    try {
      await imageManager.deleteImage(imageID);
      await imageManager.refreshImages();
      event.reply('images-process-ended', 0);
    } catch (err) {
      await Electron.dialog.showMessageBox({
        message: `Error trying to delete image ${ imageName } (${ imageID }):\n\n ${ err.stderr } `,
        type:    'error'
      });
      event.reply('images-process-ended', 1);
    }
  });

  Electron.ipcMain.on('do-image-build', async(event, taggedImageName) => {
    const options: any = {
      title:      'Pick the build directory',
      properties: ['openFile'],
      message:    'Please select the Dockerfile to use (could have a different name)'
    };

    if (lastBuildDirectory) {
      options.defaultPath = lastBuildDirectory;
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

    lastBuildDirectory = pathParts.dir;
    try {
      code = (await imageManager.buildImage(lastBuildDirectory, pathParts.base, taggedImageName)).code;
      await imageManager.refreshImages();
    } catch (err) {
      code = err.code;
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
      code = (await imageManager.pullImage(taggedImageName)).code;
      await imageManager.refreshImages();
    } catch (err) {
      code = err.code;
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
      code = (await imageManager.scanImage(taggedImageName)).code;
      await imageManager.refreshImages();
    } catch (err) {
      code = err.code;
      Electron.dialog.showMessageBox({
        message: `Error trying to scan ${ taggedImageName }:\n\n ${ err.stderr } `,
        type:    'error'
      });
    }
    event.reply('images-process-ended', code);
  });

  Electron.ipcMain.on('do-image-push', async(event, imageName, imageID, tag) => {
    const taggedImageName = `${ imageName }:${ tag }`;
    let code;

    try {
      code = (await imageManager.pushImage(taggedImageName)).code;
    } catch (err) {
      code = err.code;
      Electron.dialog.showMessageBox({
        message: `Error trying to push ${ taggedImageName }:\n\n ${ err.stderr } `,
        type:    'error'
      });
    }
    event.reply('images-process-ended', code);
  });

  Electron.ipcMain.handle('images-check-state', () => {
    return imageManager.isReady;
  });

  return imageManager;
}
