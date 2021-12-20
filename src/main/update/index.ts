/**
 * This module contains code for handling auto-updates.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import { CustomPublishOptions } from 'builder-util-runtime';
import Electron from 'electron';
import {
  AppImageUpdater, MacUpdater, NsisUpdater,
  AppUpdater, ProgressInfo, UpdateInfo
} from 'electron-updater';
import yaml from 'yaml';

import { Settings } from '@/config/settings';
import mainEvent from '@/main/mainEvents';
import Logging from '@/utils/logging';
import * as window from '@/window';
import LonghornProvider, { hasQueuedUpdate, setHasQueuedUpdate } from './LonghornProvider';

const console = Logging.update;

let autoUpdater: AppUpdater;
/** Wether the application is built with updater configuration. */
let hasUpdateConfiguration = true;
/** Whether we've run the update check at least once this run. */
let checked = false;

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

Electron.ipcMain.on('update-state', () => {
  window.send('update-state', updateState);
});

async function getUpdater(): Promise<AppUpdater> {
  let updater: AppUpdater;

  try {
    let appUpdateConfigPath: string;

    if (Electron.app.isPackaged) {
      appUpdateConfigPath = path.join(process.resourcesPath, 'app-update.yml');
    } else {
      appUpdateConfigPath = path.join(Electron.app.getAppPath(), 'dev-app-update.yml');
    }

    let fileContents : string;

    try {
      fileContents = await fs.promises.readFile(appUpdateConfigPath, { encoding: 'utf8' });
    } catch (ex) {
      if ((ex as NodeJS.ErrnoException).code === 'ENOENT') {
        hasUpdateConfiguration = false;
      }
      throw ex;
    }
    const options: CustomPublishOptions = yaml.parse(fileContents);

    options.updateProvider = LonghornProvider;

    switch (os.platform()) {
    case 'win32':
      updater = new NsisUpdater(options);
      break;
    case 'darwin':
      updater = new MacUpdater(options);
      break;
    case 'linux':
      updater = new AppImageUpdater(options);
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
  if (settings.updater && !checked) {
    setupUpdate(true, false);
  }
});

/**
 * Set up the updater, and possibly run the updater if it has already been
 * downloaded and is ready to install.
 *
 * @param enabled Whether updates are enabled
 * @param doInstall Install updates if available.
 * @returns Whether the update is being installed.
 */
export default async function setupUpdate(enabled: boolean, doInstall = false): Promise<boolean> {
  if (!updateState.configured) {
    try {
      autoUpdater = await getUpdater();
    } catch (ex) {
      if (!hasUpdateConfiguration) {
        return false;
      }
      throw ex;
    }
    updateState.configured = true;
  }
  window.send('update-state', updateState);

  if (!enabled) {
    return false;
  }

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
      checked = true;
    });
  }

  autoUpdater.checkForUpdates();
  checked = true;

  return false;
}
