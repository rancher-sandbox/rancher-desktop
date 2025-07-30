/**
 * This module contains code for handling auto-updates.
 */

import fs from 'fs';
import os from 'os';
import timers from 'timers';

import { CustomPublishOptions } from 'builder-util-runtime';
import Electron from 'electron';
import {
  AppImageUpdater, MacUpdater, AppUpdater, ProgressInfo, UpdateInfo,
} from 'electron-updater';
import { ElectronAppAdapter } from 'electron-updater/out/ElectronAppAdapter';
import yaml from 'yaml';

import LonghornProvider, { hasQueuedUpdate, LonghornUpdateInfo, setHasQueuedUpdate } from './LonghornProvider';
import MsiUpdater from './MSIUpdater';

import { Settings } from '@pkg/config/settings';
import mainEvent from '@pkg/main/mainEvents';
import Logging from '@pkg/utils/logging';
import * as window from '@pkg/window';

const console = Logging.update;

/** State describes how for into start up we are. */
enum State {
  /** Startup hasn't been attempted yet. */
  UNCONFIGURED,
  /** No update configuration; updates are not available. */
  NO_CONFIGURATION,
  /** Updater has been configured, but no checks have been triggered. */
  CONFIGURED,
  /** We have triggered at least one update check. */
  CHECKED,
  /** An update is being downloaded; suppress checks. */
  DOWNLOADING,
  /** An update is pending; we should not check again. */
  UPDATE_PENDING,
  /** An error has occurred configuring the updater. */
  ERROR,
}
let state: State = State.UNCONFIGURED;

let autoUpdater: AppUpdater;
/** When we should check for updates next. */
let updateTimer: NodeJS.Timeout;
/** The update interval reported by the server. */
let updateInterval = 0;

export interface UpdateState {
  configured: boolean;
  available:  boolean;
  downloaded: boolean;
  error?:     Error;
  info?:      LonghornUpdateInfo;
  progress?:  ProgressInfo;
}
const updateState: UpdateState = {
  configured: false, available: false, downloaded: false,
};

Electron.ipcMain.on('update-state', () => {
  window.send('update-state', updateState);
});

Electron.ipcMain.on('update-apply', () => {
  if (!autoUpdater || process.env.RD_FORCE_UPDATES_ENABLED) {
    return;
  }
  autoUpdater.quitAndInstall();
});

function isLonghornUpdateInfo(info: UpdateInfo | LonghornUpdateInfo): info is LonghornUpdateInfo {
  return (info as LonghornUpdateInfo).nextUpdateTime !== undefined;
}

/**
 * Return a new AppUpdater; if no update configuration is available, returns
 * undefined.
 */
async function getUpdater(): Promise<AppUpdater | undefined> {
  let updater: AppUpdater;

  try {
    const { appUpdateConfigPath } = new ElectronAppAdapter();
    let fileContents : string;

    try {
      fileContents = await fs.promises.readFile(appUpdateConfigPath, { encoding: 'utf8' });
    } catch (ex) {
      if ((ex as NodeJS.ErrnoException).code === 'ENOENT') {
        console.debug(`No update configuration found in ${ appUpdateConfigPath }`);

        return undefined;
      }
      throw ex;
    }
    const options: CustomPublishOptions = yaml.parse(fileContents);

    options.updateProvider = LonghornProvider;

    if (process.env.RD_UPGRADE_RESPONDER_URL) {
      console.log(`using custom upgrade responder URL ${ process.env.RD_UPGRADE_RESPONDER_URL }`);
      options.upgradeServer = process.env.RD_UPGRADE_RESPONDER_URL;
    }

    switch (os.platform()) {
    case 'win32': {
      updater = new MsiUpdater(options);
      break;
    }
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

  if (process.env.RD_FORCE_UPDATES_ENABLED) {
    updater.forceDevUpdateConfig = true;
  }

  updater.logger = console;
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = false;
  updater.on('error', (error) => {
    console.debug('update: error:', error);
    updateState.error = error;
    updateState.downloaded = false;
    window.send('update-state', updateState);
  });
  updater.on('checking-for-update', () => {
    console.debug('update: checking for update');
    updateState.available = false;
    updateState.downloaded = false;
    setHasQueuedUpdate(false);
  });
  updater.on('update-available', (info) => {
    if (!isLonghornUpdateInfo(info)) {
      throw new Error('updater: event update-available: info is not of type LonghornUpdateInfo');
    }
    console.debug('update: update available:', info);
    updateState.available = true;
    updateState.info = info;
    updateState.downloaded = state === State.UPDATE_PENDING;
    window.send('update-state', updateState);
  });
  updater.on('update-not-available', (info) => {
    if (!isLonghornUpdateInfo(info)) {
      throw new Error('updater: event update-not-available: info is not of type LonghornUpdateInfo');
    }
    console.debug('update: not available:', info);
    updateState.available = false;
    updateState.info = info;
    updateState.downloaded = false;
    setHasQueuedUpdate(false);
    window.send('update-state', updateState);
  });
  updater.on('download-progress', (progress) => {
    if (state === State.CHECKED || state === State.UPDATE_PENDING) {
      state = State.DOWNLOADING;
    }
    updateState.progress = progress;
    updateState.downloaded = false;
    window.send('update-state', updateState);
  });
  updater.on('update-downloaded', (info) => {
    if (!isLonghornUpdateInfo(info)) {
      throw new Error('updater: event update-downloaded: info is not of type LonghornUpdateInfo');
    }
    if (state === State.DOWNLOADING) {
      state = State.UPDATE_PENDING;
    }
    console.debug('update: downloaded:', info);
    updateState.info = info;
    updateState.downloaded = true;
    // Prevent the updater from downloading the update again; it will clobber
    // the existing download.
    updater.autoDownload = false;
    setHasQueuedUpdate(true);
    window.send('update-state', updateState);
  });

  return updater;
}

mainEvent.on('settings-update', (settings: Settings) => {
  if (settings.application.updater.enabled && state === State.CONFIGURED) {
    // We have a configured updater, but haven't done the actual check yet.
    // This means the setting was disabled when we configured the updater.
    // Start checking now.
    doInitialUpdateCheck();
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
  console.debug(`Setting up updater... enabled=${ enabled } doInstall=${ doInstall }`);
  if (state === State.UNCONFIGURED) {
    try {
      const newUpdater = await getUpdater();

      if (!newUpdater?.isUpdaterActive()) {
        console.debug(`No update configuration found.`);
        state = State.NO_CONFIGURATION;

        return false;
      }
      autoUpdater = newUpdater;
    } catch (ex) {
      state = State.ERROR;
      throw ex;
    }
  }
  updateState.configured = true;
  window.send('update-state', updateState);
  state = State.CONFIGURED;

  if (!enabled) {
    return false;
  }

  try {
    const result = await doInitialUpdateCheck(doInstall);

    state = State.CHECKED;

    return result;
  } catch (ex) {
    // If the initial update check fails, don't prevent application startup.
    state = State.ERROR;
    console.error(`Error setting up updater:`, ex);

    return false;
  }
}

/**
 * Do the initial update check.
 * @precondition autoUpdater has been set up.
 * @param doInstall If true, install the update immediately.
 * @returns Whether the update is being installed.
 */
async function doInitialUpdateCheck(doInstall = false): Promise<boolean> {
  if (doInstall && await hasQueuedUpdate() && !process.env.RD_FORCE_UPDATES_ENABLED) {
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

  triggerUpdateCheck();

  return false;
}

/**
 * Trigger an update check, and set up the timer to re-check again later.
 */
async function triggerUpdateCheck() {
  if (state !== State.DOWNLOADING) {
    const result = await autoUpdater.checkForUpdates();

    if (!result) {
      // App update is disabled (likely because the app is not packaged).
      return;
    }

    if (!isLonghornUpdateInfo(result.updateInfo)) {
      throw new Error('result.updateInfo is not of type LonghornUpdateInfo');
    }
    const updateInfo = result.updateInfo;
    const givenTimeDelta = (updateInfo.nextUpdateTime || 0) - Date.now();

    // Enforce at least one minute between checks, even if the server is reporting
    // bad times.
    updateInterval = Math.max(givenTimeDelta, 60_000);
  }

  // regardless of whether we actually made the check, schedule the next check.

  if (updateTimer) {
    timers.clearTimeout(updateTimer);
  }
  updateTimer = timers.setTimeout(triggerUpdateCheck, updateInterval);
}
