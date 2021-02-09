'use strict';

// This file contains the code to work with the settings.json file along with
// code docs on it.

const fs = require('fs');
const util = require('util');
const { dirname, join } = require('path');
const deepmerge = require('deepmerge');
const isDeepEqual = require('lodash/isEqual');
const paths = require('xdg-app-paths')({ name: 'rancher-desktop' });

// Settings versions are independent of app versions.
// Any time a version changes, increment its version by 1.
// Adding a new setting usually doesn't require incrementing the version field, because
// it will be picked up from the default settings object.
// Version incrementing is for when a breaking change is introduced in the settings object.

const CURRENT_SETTINGS_VERSION = 1;

/** @typedef {typeof defaultSettings} Settings */

const defaultSettings = {
  version:    CURRENT_SETTINGS_VERSION,
  kubernetes: {
    version:     'v1.19.2',
    /** @type { import("../k8s-engine/homestead").State } */
    rancherMode: 'HOMESTEAD',
  },
};

/**
 * Load the settings file
 * @returns {Settings}
 */
function load() {
  const rawdata = fs.readFileSync(join(paths.config(), 'settings.json'));
  let settings;
  try {
    settings = JSON.parse(rawdata);
  } catch (_) {
    save(defaultSettings);
    return defaultSettings;
  }
  // clone settings because we check to see if the returned value is different
  const cfg = updateSettings(Object.assign({}, settings));
  if (!isDeepEqual(cfg, settings)) {
    save(cfg);
  }
  return cfg;
}

/**
 * Verify that the loaded version of kubernetes, if specified, is in the current list of supported versions.  Throw an exception if not.
 * @param{Object} settings
 */

function verifyLocalSettings(settings) {
  const supportedVersions = require('@/generated/versions.json');
  const proposedVersion = settings.kubernetes?.version;
  if (proposedVersion && !supportedVersions.includes(proposedVersion)) {
    const header = 'Error in saved settings.json file';
    const message = `Proposed kubernetes version ${proposedVersion} not supported`;
    const { dialog } = require('electron');
    dialog.showErrorBox(header, message);
    throw new InvalidStoredSettings(message);
  }
}

function save(cfg) {
  try {
    fs.mkdirSync(paths.config(), { recursive: true });
    const rawdata = JSON.stringify(cfg);
    fs.writeFileSync(join(paths.config(), 'settings.json'), rawdata);
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
async function clear() {
  // The node version packed with electron might not have fs.rm yet.
  await util.promisify(fs.rm ?? fs.rmdir)(paths.config(), { recursive: true, force: true });
}

/**
 * Load the settings file or create it if not present.
 * @returns {Settings}
 */
function init() {
  let settings = {};
  try {
    settings = load();
  } catch (err) {
    if (err instanceof InvalidStoredSettings) {
      throw (err);
    }
    // Create default settings
    settings = defaultSettings;
    save(settings);
  }

  return settings;
}

async function isFirstRun() {
  const settingsPath = join(paths.config(), 'settings.json');
  try {
    await util.promisify(fs.access)(settingsPath, fs.constants.F_OK);
    return false;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.log(`Checking for existence of ${settingsPath}, got error ${err}`);
    }
    return true;
  }
}

class InvalidStoredSettings extends Error {
}

function safeFileTest(path, conditions) {
  try {
    fs.accessSync(path, conditions);
    return true;
  } catch (_) {
    return false;
  }
}

function fileExists(path) {
  try {
    fs.statSync(path);
    return true;
  } catch (_) {
    return false;
  }
}

function fileIsWritable(path) {
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
 * @param {string} fullpath
 * @returns {string}
 */
function quoteIfNeeded(fullpath) {
  return /\s/.test(fullpath) ? `"${fullpath}"` : fullpath;
}

function parseSaveError(err) {
  const msg = err.toString();
  console.log(`settings save error: ${msg}`);
  const p = new RegExp(`^Error:\\s*${err.code}:\\s*(.*?),\\s*${err.syscall}\\s+'?${err.path}`);
  const m = p.exec(msg);
  let friendlierMsg = `Error trying to ${err.syscall} ${err.path}`;
  if (m) {
    friendlierMsg += `: ${m[1]}`;
  }
  const parentPath = dirname(err.path);
  if (err.code === 'EACCES') {
    if (!fileExists(err.path)) {
      if (!fileExists(parentPath)) {
        friendlierMsg += `\n\nCouldn't create preferences directory ${parentPath}`;
      } else if (!safeFileTest(parentPath, fs.constants.W_OK | fs.constants.X_OK)) {
        friendlierMsg += `\n\nPossible fix: chmod +wx ${quoteIfNeeded(parentPath)}`;
      }
    } else if (!fileIsWritable(err.path)) {
      friendlierMsg += `\n\nPossible fix: chmod +w ${quoteIfNeeded(err.path)}`;
    }
  }
  return friendlierMsg;
}

/**
 * Provide an array of updating functions
 *
 * @type {Array.<Object.<number, (typeof defaultSettings)> => void>}
 *
 * It is currently empty, but if there are any changes across versions,
 * they should be done in a function that modifies the settings arg.  The main use-cases
 * are for renaming property names, correct values that are no longer valid, and removing
 * obsolete entries. The final step merges in current defaults, so we won't need an entry
 * for every version change, as most changes will get picked up from the defaults.
 *
 */
const updateTable = {
};

/* Example entry for going from version 3 to 4
let updateTable = {
  3: function(settings) {
      // Implement setting change from version 3 to 4
      if (settings.kubernetes.oldName && !settings.kubernetes.newName) {
         settings.kubernetes.newName = settings.kubernetes.oldName;
         delete settings.kubernetes.oldName;
      }
      if (settings.kubernetes.bird == "road runner") {
        settings.kubernetes.bird == "roadrunner" // no spaces wanted
      }
   },
};
*/

function updateSettings(settings) {
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
    console.log(`Running settings version ${CURRENT_SETTINGS_VERSION} but loaded a settings file for version ${settings.version}: some settings will be ignored`);
  }
  try {
    verifyLocalSettings(settings);
  } catch (err) {
    if (err instanceof InvalidStoredSettings) {
      throw (err);
    }
    const header = 'Error in saved settings.json file';
    const { dialog } = require('electron');
    dialog.showErrorBox(header, err.message);
  }
  settings.version = CURRENT_SETTINGS_VERSION;
  return deepmerge(defaultSettings, settings);
}

module.exports = { init, load, save, clear, isFirstRun };
