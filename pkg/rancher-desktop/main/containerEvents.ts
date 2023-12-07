/**
 * This module contains code for handling image-processor events (containerd/nerdctl, moby/docker).
 */

import Electron from 'electron';

import { ContainerProcessor } from '@pkg/backend/containers/containerProcessor';
import { getIpcMainProxy } from '@pkg/main/ipcMain';
import { isUnixError } from '@pkg/typings/unix.interface';
import Logging from '@pkg/utils/logging';

const console = Logging.images;
const ipcMainProxy = getIpcMainProxy(console);

// Map containers-related events to the associated containers processor's methods
// TODO: export the factory function to make this a singleton
/**
 * The ContainerEventHandler is a singleton.
 * It points to an active ContainerProcessor, and relays relevant events to that processor.
 * Having containers processors handle their own events is messy (see the notion of activating
 * an containers processor), and shouldn't handle any of them.
 */

export class ContainerEventHandler {
  containerProcessor: ContainerProcessor;

  constructor(ContainerProcessor: ContainerProcessor) {
    this.containerProcessor = ContainerProcessor;
    this.initEventHandlers();
  }

  protected initEventHandlers() {
    ipcMainProxy.on('do-containers-exec', async(event, command, imageID) => {
      try {
        await this.containerProcessor.runContainerCommand([command, ...imageID], true);
      } catch (err) {
        await Electron.dialog.showMessageBox({
          message: `Error trying to delete container (${ imageID }):\n\n ${
            isUnixError(err) ? err.stderr : ''
          } `,
          type: 'error',
        });
        event.reply('images-process-ended', 1);
      }
    });
  }
}
