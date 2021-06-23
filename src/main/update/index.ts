/**
 * This module contains code for handling auto-updates.
 */

import { Console } from 'console';
import os from 'os';

import { ipcMain } from 'electron';
import { AppUpdater, ProgressInfo, UpdateInfo } from 'electron-updater';

import Logging from '@/utils/logging';
import window from '@/window/window.js';
import { MacLonghornUpdater, NsisLonghornUpdater } from './LonghornUpdater';

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

export default function setupUpdate() {
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

  autoUpdater.checkForUpdates();
}
