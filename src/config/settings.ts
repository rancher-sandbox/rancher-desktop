// This file contains the code to work with the settings.json file along with
// code docs on it.

import fs from 'fs';
import os from 'os';
import { dirname, join } from 'path';

import _ from 'lodash';

import Logging from '@/utils/logging';
import paths from '@/utils/paths';

const console = Logging.settings;

// Settings versions are independent of app versions.
// Any time a version changes, increment its version by 1.
// Adding a new setting usually doesn't require incrementing the version field, because
// it will be picked up from the default settings object.
// Version incrementing is for when a breaking change is introduced in the settings object.

const CURRENT_SETTINGS_VERSION = 3;

export const defaultSettings = {
  version:    CURRENT_SETTINGS_VERSION,
  kubernetes: {
    version:     '',
    memoryInGB:  2,
    numberCPUs:  2,
    port:        6443,
  },
  portForwarding:  { includeKubernetesServices: false },
  images:          {
    showAll:   true,
    namespace: 'k8s.io',
  },
  telemetry:       true,
  /** Whether we should check for updates and apply them. */
  updater:        true,
};

export type Settings = typeof defaultSettings;

let _isFirstRun = false;

/**
 * Load the settings file
 */
export function load(): Settings {
  const rawdata = fs.readFileSync(join(paths.config, 'settings.json'));
  let settings;

  try {
    settings = JSON.parse(rawdata.toString());
  } catch (_) {
    save(defaultSettings);

    return defaultSettings;
  }
  // clone settings because we check to see if the returned value is different
  const cfg = updateSettings(Object.assign({}, settings));

  if (!_.isEqual(cfg, settings)) {
    save(cfg);
  }

  return cfg;
}

export function save(cfg: Settings) {
  try {
    fs.mkdirSync(paths.config, { recursive: true });
    const rawdata = JSON.stringify(cfg);

    fs.writeFileSync(join(paths.config, 'settings.json'), rawdata);
  } catch (err) {
    if (err) {
      const { dialog } = require('electron');

      dialog.showErrorBox('Unable To Save Settings File', parseSaveError(err));
    } else {
      console.log('Settings file saved\n');
    }
  }
}

/**
 * Remove all stored settings.
 */
export async function clear() {
  // The node version packed with electron might not have fs.rm yet.
  await fs.promises.rmdir(paths.config, { recursive: true, force: true } as any);
}

/**
 * Load the settings file or create it if not present.
 */
export function init(): Settings {
  let settings: Settings;

  try {
    settings = load();
    _isFirstRun = false;
  } catch (err: any) {
    if (err instanceof InvalidStoredSettings) {
      throw (err);
    }
    settings = defaultSettings;
    if (err.code === 'ENOENT') {
      _isFirstRun = true;
      if (os.platform() === 'darwin' || os.platform() === 'linux') {
        const totalMemoryInGB = os.totalmem() / 2 ** 30;

        // 25% of available ram up to a maximum of 6gb
        settings.kubernetes.memoryInGB = Math.min(6, Math.round(totalMemoryInGB / 4.0));
      }
    }
    if (os.platform() === 'linux' && !process.env['APPIMAGE']) {
      settings.updater = false;
    }
    save(settings);
  }

  return settings;
}

export function isFirstRun() {
  return _isFirstRun;
}

class InvalidStoredSettings extends Error {
}

function safeFileTest(path: string, conditions: number) {
  try {
    fs.accessSync(path, conditions);

    return true;
  } catch (_) {
    return false;
  }
}

function fileExists(path: string) {
  try {
    fs.statSync(path);

    return true;
  } catch (_) {
    return false;
  }
}

function fileIsWritable(path: string) {
  try {
    fs.accessSync(path, fs.constants.W_OK);

    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Simple function to wrap paths with spaces with double-quotes. Intended for human consumption.
 * Trying to avoid adding yet another external dependency.
 */
function quoteIfNeeded(fullpath: string): string {
  return /\s/.test(fullpath) ? `"${ fullpath }"` : fullpath;
}

function parseSaveError(err: any) {
  const msg = err.toString();

  console.log(`settings save error: ${ msg }`);
  const p = new RegExp(`^Error:\\s*${ err.code }:\\s*(.*?),\\s*${ err.syscall }\\s+'?${ err.path }`);
  const m = p.exec(msg);
  let friendlierMsg = `Error trying to ${ err.syscall } ${ err.path }`;

  if (m) {
    friendlierMsg += `: ${ m[1] }`;
  }
  const parentPath = dirname(err.path);

  if (err.code === 'EACCES') {
    if (!fileExists(err.path)) {
      if (!fileExists(parentPath)) {
        friendlierMsg += `\n\nCouldn't create preferences directory ${ parentPath }`;
      } else if (!safeFileTest(parentPath, fs.constants.W_OK | fs.constants.X_OK)) {
        friendlierMsg += `\n\nPossible fix: chmod +wx ${ quoteIfNeeded(parentPath) }`;
      }
    } else if (!fileIsWritable(err.path)) {
      friendlierMsg += `\n\nPossible fix: chmod +w ${ quoteIfNeeded(err.path) }`;
    }
  }

  return friendlierMsg;
}

/**
 * Provide an array of updating functions
 *
 * It is currently empty, but if there are any changes across versions,
 * they should be done in a function that modifies the settings arg.  The main use-cases
 * are for renaming property names, correct values that are no longer valid, and removing
 * obsolete entries. The final step merges in current defaults, so we won't need an entry
 * for every version change, as most changes will get picked up from the defaults.
 *
 */
const updateTable: Record<number, (settings: any) => void> = {
  1: (settings) => {
    // Implement setting change from version 3 to 4
    if ('rancherMode' in settings.kubernetes) {
      delete settings.kubernetes.rancherMode;
    }
  },
  2: (settings) => {
    if (os.platform() === 'darwin') {
      console.log('Removing hyperkit virtual machine files');
      try {
        // eslint-disable-next-line deprecation/deprecation -- Needed for compatibility.
        fs.accessSync(paths.hyperkit);
        // eslint-disable-next-line deprecation/deprecation -- Needed for compatibility.
        fs.rmSync(paths.hyperkit, { recursive: true, force: true });
      } catch (err) {
        if (err !== 'ENOENT') {
          console.log(err);
        }
      }
    }
  }
};

function updateSettings(settings: Settings) {
  if (Object.keys(settings).length === 0) {
    return defaultSettings;
  }
  let loadedVersion = settings.version || 0;

  if (loadedVersion < CURRENT_SETTINGS_VERSION) {
    for (; loadedVersion < CURRENT_SETTINGS_VERSION; loadedVersion++) {
      if (updateTable[loadedVersion]) {
        updateTable[loadedVersion](settings);
      }
    }
  } else if (settings.version && settings.version > CURRENT_SETTINGS_VERSION) {
    // We've loaded a setting file from the future, so some settings will be ignored.
    // Try not to step on them.
    // Note that this file will have an older version field but some fields from the future.
    console.log(`Running settings version ${ CURRENT_SETTINGS_VERSION } but loaded a settings file for version ${ settings.version }: some settings will be ignored`);
  }
  settings.version = CURRENT_SETTINGS_VERSION;

  return _.defaultsDeep(settings, defaultSettings);
}

// Imported from dashboard/config/settings.js
// Setting IDs
export const SETTING = { PL_RANCHER_VALUE: 'rancher' };
