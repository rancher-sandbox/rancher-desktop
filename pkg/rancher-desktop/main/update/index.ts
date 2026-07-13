/**
 * This module contains code for handling auto-updates.
 */

import fs from 'fs';
import os from 'os';
import timers from 'timers';

import { CustomPublishOptions } from 'builder-util-runtime';
import Electron from 'electron';
import { AppImageUpdater } from 'electron-updater/out/AppImageUpdater';
import { ElectronAppAdapter } from 'electron-updater/out/ElectronAppAdapter';
import { MacUpdater } from 'electron-updater/out/MacUpdater';
import yaml from 'yaml';

import LonghornProvider, { hasQueuedUpdate, LonghornUpdateInfo, setHasQueuedUpdate } from './LonghornProvider';
import MsiUpdater from './MSIUpdater';

import { Settings } from '@pkg/config/settings';
import mainEvent from '@pkg/main/mainEvents';
import Logging from '@pkg/utils/logging';
import * as window from '@pkg/window';

import type { AppUpdater, ProgressInfo, UpdateInfo } from 'electron-updater';

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
  /** An update has been downloaded and is waiting to be installed. */
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
/** The version of the update that has finished downloading, if any. */
let stagedVersion: string | undefined;
/** Whether an install is under way; a second one must not start a second installer. */
let installStarted = false;
/**
 * How many update checks are in flight. A failing check reports through the same
 * error handler as a failing install, so a nonzero count tells the two apart: a
 * check failing must not release the install latch. It is a count, not a flag,
 * so an overlapping manual retry and scheduled check cannot clear it early.
 */
let checksInFlight = 0;

Electron.ipcMain.on('update-state', () => {
  window.send('update-state', updateState);
});

Electron.ipcMain.on('update-apply', () => {
  if (!autoUpdater || process.env.RD_FORCE_UPDATES_ENABLED) {
    return;
  }
  if (installStarted) {
    // The button that sends this disables itself, but it forgets that when the
    // user navigates away and back, and a second quitAndInstall() hands the
    // same update to a second installer process.
    return;
  }
  installStarted = true;
  autoUpdater.quitAndInstall();
});

Electron.ipcMain.on('update-retry', () => {
  if (!autoUpdater) {
    return;
  }
  // The next check is not scheduled until some time tomorrow, which is a long
  // time to leave someone stuck with an update that failed to download.
  triggerUpdateCheck();
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
    console.error('update: error:', error);
    updateState.error = error;
    if (checksInFlight === 0) {
      // Installing may be what failed, and the application is still running to
      // report it, so let the user ask again. A check failing at the same time
      // must not release the latch, or a second install could start. The rare
      // cost: an install that fails alongside an in-flight check keeps the latch
      // until a later error with no check running, or a restart.
      installStarted = false;
    }
    if (state === State.DOWNLOADING) {
      // The download failed. triggerUpdateCheck() skips every check while we
      // are DOWNLOADING, so staying here would stop the updater retrying, or
      // even noticing a newer release, until the application restarts.
      state = State.CHECKED;
    }
    // A failed download or check does not delete an update that already
    // finished downloading; it stays installable.
    updateState.downloaded = !!stagedVersion && updateState.info?.version === stagedVersion;
    if (updateState.downloaded) {
      // checking-for-update cleared the on-disk flag on the way in; the staged
      // update outlived the failure, so put it back.
      setHasQueuedUpdate(true);
    }
    window.send('update-state', updateState);
  });
  updater.on('checking-for-update', () => {
    console.debug('update: checking for update');
    // Clear any earlier error so a transient failure stops hiding later offers.
    updateState.error = undefined;
    // Leave `available` for update-available/update-not-available to set. A
    // check that fails before either fires must not retract the card the last
    // check put up, which the renderer hides entirely without `available`.
    updateState.downloaded = false;
    // Drop stale progress so a newer offer doesn't show the previous
    // download's percentage.
    updateState.progress = undefined;
    setHasQueuedUpdate(false);
  });
  updater.on('update-available', (info) => {
    if (!isLonghornUpdateInfo(info)) {
      throw new Error('updater: event update-available: info is not of type LonghornUpdateInfo');
    }
    console.debug('update: update available:', info);
    updateState.available = true;
    updateState.info = info;
    updateState.downloaded = info.version === stagedVersion;
    if (updateState.downloaded) {
      setHasQueuedUpdate(true);
    } else {
      // A version other than the staged one is available. Forget the staged
      // version and re-arm autoDownload so the updater fetches the new one;
      // electron-updater discards the cached file when its checksum no longer
      // matches. Clearing stagedVersion keeps a later re-offer of the old
      // version from reporting it as downloaded once its file is gone.
      stagedVersion = undefined;
      updater.autoDownload = true;
    }
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
    stagedVersion = undefined;
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
    stagedVersion = info.version;
    console.debug('update: downloaded:', info);
    updateState.info = info;
    updateState.downloaded = true;
    // Don't download this same version again on the next check; a newer version
    // re-arms autoDownload from the update-available handler.
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

    const installing = await new Promise<boolean>((resolve) => {
      // Every terminal event must settle this promise: startup awaits it
      // before starting the backend, so a check that fails without emitting
      // update-downloaded (offline, or the release was pulled) would hang the
      // app forever. Remove the listeners on the way out so a later periodic
      // check's update-downloaded can't fire a stale quitAndInstall.
      const finish = (installing: boolean) => {
        autoUpdater.removeListener('error', onError);
        autoUpdater.removeListener('update-not-available', onNotAvailable);
        autoUpdater.removeListener('update-downloaded', onDownloaded);
        resolve(installing);
      };
      const onError = (e: Error) => {
        console.error('Updater got error', e);
        finish(false);
      };
      const onNotAvailable = () => {
        console.log('Cached update is no longer offered; continuing startup.');
        finish(false);
      };
      const onDownloaded = () => {
        console.log('Update download complete; restarting app');
        // The persistent update-downloaded handler already recorded the staged
        // version and set the queued flag; here we only need to install.
        installStarted = true;
        autoUpdater.quitAndInstall(true, true);
        finish(true);
      };

      autoUpdater.once('error', onError);
      autoUpdater.once('update-not-available', onNotAvailable);
      autoUpdater.once('update-downloaded', onDownloaded);
      autoUpdater.checkForUpdates().then((result) => {
        // A falsy result means update checks are disabled, so none of the
        // events above will fire; settle here rather than wait forever.
        if (!result) {
          finish(false);
        }
      }).catch(onError);
    });

    if (installing) {
      return true;
    }
    // The cached update could not be installed (offline, the release was
    // pulled, or checks are disabled); fall through to schedule periodic
    // checks so the session keeps looking for updates.
  }

  triggerUpdateCheck();

  return false;
}

/**
 * Trigger an update check, and set up the timer to re-check again later.
 */
async function triggerUpdateCheck() {
  // Skip only while a download is under way; a fresh check would race it. An
  // install running at the same time is fine: checksInFlight keeps a failure
  // here from being read as a failed install, and gating the check on the
  // install instead would wedge every later check once a quit-to-install is
  // cancelled and never clears the latch.
  if (state !== State.DOWNLOADING) {
    checksInFlight += 1;
    try {
      const result = await autoUpdater.checkForUpdates();

      if (!result) {
        // App update is disabled.
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
      console.log(`Update check complete; next check at ${ new Date(Date.now() + updateInterval).toISOString() }`);
    } catch (ex) {
      // Without catching here, a transient failure (network blip, malformed
      // server response, missing release asset) would skip the timer rearm
      // below and silently stop all future checks until the app restarts.
      // Retry in 10 minutes to recover within a normal session.
      console.error('Error checking for updates; will retry in 10 minutes:', ex);
      updateInterval = 10 * 60_000;
    } finally {
      checksInFlight -= 1;
    }
  }

  // regardless of whether we actually made the check, schedule the next check.

  if (updateTimer) {
    timers.clearTimeout(updateTimer);
  }
  updateTimer = timers.setTimeout(triggerUpdateCheck, updateInterval);
}
