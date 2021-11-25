/**
 * This module contains code for handling auto-updates.
 */

import os from 'os';

import { ipcMain } from 'electron';
import { AppUpdater, ProgressInfo, UpdateInfo } from 'electron-updater';

import { Settings } from '@/config/settings';
import mainEvent from '@/main/mainEvents';
import Logging from '@/utils/logging';
import * as window from '@/window';
import { MacLonghornUpdater, NsisLonghornUpdater, LinuxLonghornUpdater } from './LonghornUpdater';
import { hasQueuedUpdate, setHasQueuedUpdate } from './LonghornProvider';

interface CustomAppUpdater extends AppUpdater {
  hasUpdateConfiguration: Promise<boolean>;
}

const console = Logging.update;

let autoUpdater: CustomAppUpdater;
let enabled = false;

export type UpdateState = {
  configured: boolean;
  available: boolean;
  downloaded: boolean;
  error?: Error;
  info?: UpdateInfo;
  progress?: ProgressInfo;
}
const updateState: UpdateState = {
  configured: false, available: false, downloaded: false
};

ipcMain.on('update-state', () => {
  window.send('update-state', updateState);
});

function newUpdater(): CustomAppUpdater {
  let updater: CustomAppUpdater;

  try {
    switch (os.platform()) {
    case 'win32':
      updater = new NsisLonghornUpdater();
      break;
    case 'darwin':
      updater = new MacLonghornUpdater();
      break;
    case 'linux':
      updater = new LinuxLonghornUpdater();
      break;
    default:
      throw new Error(`Don't know how to create updater for platform ${ os.platform() }`);
    }
  } catch (e) {
    console.error(e);
    throw e;
  }

  updater.logger = console;
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = false;
  updater.on('error', (error) => {
    updateState.error = error;
    updateState.downloaded = false;
    window.send('update-state', updateState);
  });
  updater.on('checking-for-update', () => {
    updateState.available = false;
    updateState.downloaded = false;
    setHasQueuedUpdate(false);
  });
  updater.on('update-available', (info) => {
    updateState.available = true;
    updateState.info = info;
    updateState.downloaded = false;
    window.send('update-state', updateState);
  });
  updater.on('update-not-available', (info) => {
    updateState.available = false;
    updateState.info = info;
    updateState.downloaded = false;
    setHasQueuedUpdate(false);
    window.send('update-state', updateState);
  });
  updater.on('download-progress', (progress) => {
    updateState.progress = progress;
    updateState.downloaded = false;
    window.send('update-state', updateState);
  });
  updater.on('update-downloaded', (info) => {
    updateState.info = info;
    updateState.downloaded = true;
    setHasQueuedUpdate(true);
    window.send('update-state', updateState);
  });

  return updater;
}

mainEvent.on('settings-update', (settings: Settings) => {
  if (settings.updater && !enabled) {
    enabled = true;
    setupUpdate(settings, false);
  }
});

/**
 * Set up the updater, and possibly run the updater if it has already been
 * downloaded and is ready to install.
 *
 * @param doInstall Install updates if available.
 * @returns Whether the update is being installed.
 */
export default async function setupUpdate(settings: Settings, doInstall = false): Promise<boolean> {
  enabled = settings.updater;
  if (!enabled) {
    return false;
  }
  autoUpdater ||= newUpdater();

  try {
    if (!await autoUpdater.hasUpdateConfiguration) {
      return false;
    }
  } catch (e) {
    console.log(`autoUpdater.hasUpdateConfiguration check failed: ${ e }`);

    return false;
  }
  updateState.configured = true;
  window.send('update-state', updateState);

  if (doInstall && await hasQueuedUpdate()) {
    console.log('Update is cached; forcing re-check to install.');

    return await new Promise((resolve) => {
      let hasError = false;

      autoUpdater.once('error', (e) => {
        console.error('Updater got error', e);
        hasError = true;
      });
      autoUpdater.once('update-downloaded', () => {
        console.log('Update download complete; restarting app');
        setHasQueuedUpdate(true);
        autoUpdater.quitAndInstall(true, true);
        console.log(`Install complete, result: ${ !hasError }`);
        resolve(!hasError);
      });
      autoUpdater.checkForUpdates();
    });
  }

  autoUpdater.checkForUpdates();

  return false;
}
