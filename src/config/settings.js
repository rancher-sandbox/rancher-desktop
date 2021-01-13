'use strict';

// This file contains the code to work with the settings.json file along with
// code docs on it.

const paths = require('xdg-app-paths')({name: 'rancher-desktop'});
const fs = require('fs');
const util = require('util');
const { dirname } = require('path');
const deepmerge = require('deepmerge');

// Load the settings file
function load() {

  // read the settings file into memory
  const rawdata = fs.readFileSync(paths.config() + '/settings.json');
  let settings = JSON.parse(rawdata);
  let cfg = deepmerge(defaultSettings, settings);

  // TODO: validate it

  return cfg;

}

const defaultSettings = {
  kubernetes: {
    version: "v1.19.2"
  },
  minikube: {
    allocations: {
      memory_in_gb: "1"
    }
  }
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

module.exports = { init, load, save, clear };
