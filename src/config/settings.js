'use strict';

// This file contains the code to work with the settings.json file along with
// code docs on it.

const paths = require('xdg-app-paths')({name: 'rancher-desktop'});
const fs = require('fs');
const util = require('util');
const { dirname } = require('path');
const deepmerge = require('deepmerge');
const isDeepEqual = require('lodash/isEqual');

// Settings versions are independent of app versions.
// Any time a version changes, increment its version by 1.
// Adding a new setting usually doesn't require incrementing the version field, because
// it will be picked up from the default settings object.
// Version incrementing is for when a breaking change is introduced in the settings object.

const CURRENT_SETTINGS_VERSION = 1;

const defaultSettings = {
  version: CURRENT_SETTINGS_VERSION,
  kubernetes: {
    version: "v1.19.2"
  }
}

// Load the settings file
function load(inBrowser=false) {
  const rawdata = fs.readFileSync(paths.config() + '/settings.json');
  let settings;
  try {
    settings = JSON.parse(rawdata);
  } catch(_) {
    settings = {}
  }
  // clone settings because we check to see if the returned value is different
  let cfg = updateSettings(Object.assign({}, settings));
  if (!isDeepEqual(cfg, settings)) {
    save(cfg, inBrowser);
  }
  return cfg;
}

function save(cfg, inBrowser) {
  try {
    fs.mkdirSync(paths.config(), {recursive: true});
    let rawdata = JSON.stringify(cfg);
    fs.writeFileSync(paths.config() + '/settings.json', rawdata);
  } catch (err) {
    if (err) {
      let msg = parseSaveError(err);
      if (inBrowser) {
        alert("Unable To Save Settings File: " + msg);
      } else {
        const {dialog} = require('electron');
        dialog.showErrorBox("Unable To Save Settings File", msg);
      }
    } else {
      console.log("Settings file saved\n");
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

// Load the settings file or create it if not present.
function init() {
  let settings = {};
  try {
    settings = load();
  } catch (err) {
    // Create default settings
    settings = defaultSettings;

    // TODO: save settings file
    save(settings);
  }

  return settings;
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
  let msg = err.toString();
  console.log(`settings save error: ${msg}`);
  let p = new RegExp(`^Error:\\s*${err.code}:\\s*(.*?),\\s*${err.syscall}\\s+'?${err.path}`);
  let m = p.exec(msg);
  let friendlierMsg = `Error trying to ${err.syscall} ${err.path}`;
  if (m) {
    friendlierMsg += `: ${m[1]}`;
  }
  let parentPath = dirname(err.path);
  if (err.code == 'EACCES') {
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

// updateTable is a hash of [integer, function(settings) => void].
//
// It is currently empty, but if there are any changes across versions,
// they should be done in a function that modifies the settings arg.  The main use-cases
// are for renaming property names, correct values that are no longer valid, and removing
// obsolete entries. The final step merges in current defaults, so we won't need an entry
// for every version change, as most changes will get picked up from the defaults.
//
// For example:
/*
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
let updateTable = {
};

function updateSettings(settings) {
  if (Object.keys(settings).length == 0) {
    return defaultSettings;
  }
  let loaded_version = settings.version || 0;
  if (loaded_version < CURRENT_SETTINGS_VERSION) {
    for (; loaded_version < CURRENT_SETTINGS_VERSION; loaded_version++) {
      if (updateTable[loaded_version]) {
        updateTable[loaded_version](settings);
      }
    }
  } else if (settings.version && settings.version > CURRENT_SETTINGS_VERSION) {
    // We've loaded a setting file from the future, so some settings will be ignored.
    // Try not to step on them.
    // Note that this file will have an older version field but some fields from the future.
    console.log(`Running settings version ${CURRENT_SETTINGS_VERSION} but loaded a settings file for version ${settings.version}: some settings will be ignored`);
  }
  settings.version = CURRENT_SETTINGS_VERSION;
  return deepmerge(defaultSettings, settings);
}


module.exports = { init, load, save, clear };
