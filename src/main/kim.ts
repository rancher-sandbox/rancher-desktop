/**
 * This module contains code for handling kim (images).
 */

import { Console } from 'console';
import path from 'path';
import util from 'util';

import Electron from 'electron';

import Kim from '@/k8s-engine/kim';
import Logging from '@/utils/logging';
import window from '@/window/window.js';

const console = new Console(Logging.kim.stream);

let imageManager: Kim;
let lastBuildDirectory = '';
let mountCount = 0;

export function setupKim() {
  imageManager = imageManager ?? new Kim();

  interface KimImage {
    imageName: string,
    tag: string,
    imageID: string,
    size: string
  }
  imageManager.on('readiness-changed', (state: boolean) => {
    window.send('images-check-state', state);
  });
  imageManager.on('kim-process-output', (data: string, isStderr: boolean) => {
    window.send('kim-process-output', data, isStderr);
  });

  function onImagesChanged(images: KimImage[]) {
    window.send('images-changed', images);
  }
  Electron.ipcMain.handle('images-mounted', (_, mounted: boolean) => {
    mountCount += mounted ? 1 : -1;
    if (mountCount < 1) {
      imageManager.removeListener('images-changed', onImagesChanged);
    } else if (mountCount === 1) {
      imageManager.on('images-changed', onImagesChanged);
    }

    return imageManager.listImages();
  });

  Electron.ipcMain.on('confirm-do-image-deletion', async(event, imageName, imageID) => {
    const choice = Electron.dialog.showMessageBoxSync({
      message:   `Delete image ${ imageName }?`,
      type:      'warning',
      buttons:   ['Yes', 'No'],
      defaultId: 1,
      title:     `Delete image ${ imageName }`,
      cancelId:  1
    });

    if (choice === 0) {
      try {
        const maxNumAttempts = 2;
        // On macOS a second attempt is needed to actually delete the image.
        // Probably due to a timing issue on the server part of kim, but not determined why.
        // Leave this in for windows in case it can happen there too.
        let i = 0;

        for (i = 0; i < maxNumAttempts; i++) {
          await imageManager.deleteImage(imageID);
          await imageManager.refreshImages();
          if (!imageManager.listImages().some(image => image.imageID === imageID)) {
            break;
          }
          await util.promisify(setTimeout)(500);
        }
        if (i === maxNumAttempts) {
          console.log(`Failed to delete ${ imageID } in ${ maxNumAttempts } tries`);
        }
        event.reply('kim-process-ended', 0);
      } catch (err) {
        Electron.dialog.showMessageBox({
          message: `Error trying to delete image ${ imageName } (${ imageID }):\n\n ${ err.stderr } `,
          type:    'error'
        });
      }
    }
  });

  Electron.ipcMain.on('do-image-build', async(event, taggedImageName: string) => {
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
      event.reply('kim-process-cancelled');

      return;
    }
    if (results.length !== 1) {
      console.log(`Expecting exactly one result, got ${ results.join(', ') }`);
      event.reply('kim-process-cancelled');

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
      Electron.dialog.showMessageBox({
        message: `Error trying to build ${ taggedImageName }:\n\n ${ err.stderr } `,
        type:    'error'
      });
    }
    event.reply('kim-process-ended', code);
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
      Electron.dialog.showMessageBox({
        message: `Error trying to pull ${ taggedImageName }:\n\n ${ err.stderr } `,
        type:    'error'
      });
    }
    event.reply('kim-process-ended', code);
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
    event.reply('kim-process-ended', code);
  });

  Electron.ipcMain.handle('images-check-state', () => {
    return imageManager.isReady;
  });
}
