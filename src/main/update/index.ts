/**
 * This module contains code for handling auto-updates.
 */

import { Console } from 'console';
import os from 'os';
import timers from 'timers';

import { ipcMain } from 'electron';
import { AppUpdater, ProgressInfo, UpdateInfo } from 'electron-updater';

import { Settings, save as saveSettings } from '@/config/settings';
import Logging from '@/utils/logging';
import * as window from '@/window';
import { MacLonghornUpdater, NsisLonghornUpdater } from './LonghornUpdater';
import { isLonghornUpdateInfo } from './LonghornProvider';

const console = new Console(Logging.update.stream);

let autoUpdater: AppUpdater;

export type UpdateState = {
  available: boolean;
  downloaded: boolean;
  error?: Error;
  info?: UpdateInfo;
  progress?: ProgressInfo;
}
const updateState: UpdateState = { available: false, downloaded: false };

function newUpdater() {
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
}

let updateCheckTimer: ReturnType<typeof timers.setTimeout>;

/**
 * Check for updates, if the update timer allows for it.
 */
async function maybeCheckForUpdates(settings: Settings) {
  const setupTimer = function(interval: number) {
    const target = new Date(Date.now() + interval);

    console.debug(`Setting up next check for ${ target }`);
    updateCheckTimer = timers.setTimeout(maybeCheckForUpdates, interval, settings);
  };

  if (updateCheckTimer) {
    timers.clearTimeout(updateCheckTimer);
  }
  const delta = settings.nextUpdateCheck - Date.now();

  if (delta >= 0) {
    // NodeJS timers can't be larger than max int32.
    setupTimer(Math.min(delta, 1 << 31));

    return;
  }
  try {
    const updateInfo = (await autoUpdater.checkForUpdates()).updateInfo;
    let interval: number;

    if (isLonghornUpdateInfo(updateInfo)) {
      interval = updateInfo.requestIntervalInMinutes * 60 * 1000;
    } else {
      console.debug(`Got update, but not from Longhorn provider; defaulting to check again in 1 day.`);
      interval = 24 * 60 * 60 * 1000;
    }
    settings.nextUpdateCheck = Date.now() + interval;
    saveSettings(settings);
    setupTimer(interval);
  } catch (ex) {
    console.error(`Update check failed: ${ ex } (will check again in 1 hour).`);
    // Update check failed; try again in an hour.
    setupTimer(60 * 60 * 1000);
  }
}

export default function setupUpdate(settings: Settings) {
  if (!autoUpdater) {
    autoUpdater ||= newUpdater();
    autoUpdater.logger = console;
    autoUpdater.on('error', (error) => {
      updateState.error = error;
      updateState.downloaded = false;
      window.send('update-state', updateState);
    });
    autoUpdater.on('checking-for-update', () => {
      updateState.available = false;
      updateState.downloaded = false;
    });
    autoUpdater.on('update-available', (info) => {
      updateState.available = true;
      updateState.info = info;
      updateState.downloaded = false;
      window.send('update-state', updateState);
    });
    autoUpdater.on('update-not-available', (info) => {
      updateState.available = false;
      updateState.info = info;
      updateState.downloaded = false;
      window.send('update-state', updateState);
    });
    autoUpdater.on('download-progress', (progress) => {
      updateState.progress = progress;
      updateState.downloaded = false;
      window.send('update-state', updateState);
    });
    autoUpdater.on('update-downloaded', (info) => {
      updateState.info = info;
      updateState.downloaded = true;
      window.send('update-state', updateState);
    });
  }

  ipcMain.on('update-state', () => {
    window.send('update-state', updateState);
  });

  maybeCheckForUpdates(settings);
}
