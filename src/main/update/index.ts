/**
 * This module contains code for handling auto-updates.
 */

import { Console } from 'console';
import os from 'os';

import { AppUpdater } from 'electron-updater/out/AppUpdater';

import Logging from '@/utils/logging';
import { MacLonghornUpdater, NsisLonghornUpdater } from './LonghornUpdater';

const console = new Console(Logging.update.stream);

let autoUpdater: AppUpdater;

export default function setupUpdate() {
  autoUpdater ||= (() => {
    try {
      switch (os.platform()) {
      case 'win32':
        return new NsisLonghornUpdater();
      case 'darwin':
        return new MacLonghornUpdater();
      default:
        throw new Error(`Don't know how to create updater for platform ${ os.platform() }`);
      }
    } catch (e) {
      console.error(e);
      throw e;
    }
  })();
  autoUpdater.logger = console;
  autoUpdater.checkForUpdatesAndNotify();
}
