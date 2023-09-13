// This file contains the code to work with the settings.json file along with
// code docs on it.

import fs from 'fs';
import os from 'os';
import { dirname, join } from 'path';

import _ from 'lodash';

import {
  ContainerEngine, CURRENT_SETTINGS_VERSION, defaultSettings, DeploymentProfileType,
  LockedSettingsType, Settings,
} from '@pkg/config/settings';
import { PathManagementStrategy } from '@pkg/integrations/pathManager';
import clone from '@pkg/utils/clone';
import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';
import { RecursivePartial, RecursiveReadonly } from '@pkg/utils/typeUtils';
import { getProductionVersion } from '@pkg/utils/version';

const console = Logging.settings;

// A settings-like type with a subset of all the fields of defaultSettings,
// but all leaves are set to `true`.
let lockedSettings: LockedSettingsType = {};

let _isFirstRun = false;
let settings: Settings | undefined;

/**
 * Load the settings file from disk, doing any migrations as necessary.
 */
function loadFromDisk(): Settings {
  // Throw an ENOENT error if the file doesn't exist; the caller should know what to do.
  const rawdata = fs.readFileSync(join(paths.config, 'settings.json'));
  const cfg = clone(defaultSettings);

  try {
    // If the existing settings file is partial, fill in the missing fields with defaults.
    merge(cfg, JSON.parse(rawdata.toString()));

    return migrateSettingsToCurrentVersion(cfg);
  } catch (err: any) {
    console.error(`Error JSON-parsing existing settings contents ${ rawdata }`, err);
    console.error('The old settings file will be replaced with the default settings.');

    return cfg;
  }
}

export function save(cfg: Settings) {
  try {
    fs.mkdirSync(paths.config, { recursive: true });
    const rawdata = JSON.stringify(cfg);

    fs.writeFileSync(join(paths.config, 'settings.json'), rawdata);

    // update the in-memory copy so subsequent calls to settings.load() will
    // return an up to date settings object
    settings = cfg;
  } catch (err) {
    if (err) {
      const { dialog } = require('electron');

      dialog.showErrorBox('Unable To Save Settings File', parseSaveError(err));
    } else {
      console.log('Settings file saved\n');
    }
  }
}

export function getSettings(): Settings {
  return settings ?? defaultSettings;
}

/**
 * createSettings
 * - Called when either there's no settings file, or for testing purposes, where we want to use a particular deployment profile.
 * @param {DeploymentProfileType} deploymentProfiles
 * @returns default settings merged with any default profile
 */
export function createSettings(deploymentProfiles: DeploymentProfileType): Settings {
  const cfg = clone(defaultSettings);

  cfg.virtualMachine.memoryInGB = getDefaultMemory();
  merge(cfg, deploymentProfiles.defaults);

  // If there's no deployment profile, put up the first-run dialog box.
  if (!Object.keys(deploymentProfiles.defaults).length && !Object.keys(deploymentProfiles.locked).length) {
    _isFirstRun = true;
  }

  return finishConfiguringSettings(cfg, deploymentProfiles);
}

/**
 * Used for unit testing only.
 * Could be used in core code if we ever want to reload changed deployment profiles, but that isn't needed now.
 */
export function clearSettings() {
  settings = undefined;
}

/**
 * Load the settings file or create it if not present.
 */
export function load(deploymentProfiles: DeploymentProfileType): Settings {
  if (settings) {
    return settings;
  }
  try {
    return finishConfiguringSettings(loadFromDisk(), deploymentProfiles);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return createSettings(deploymentProfiles);
    } else {
      // JSON problems in the settings file will be caught, and we let any
      // other errors (most likely permission-related) bubble up to the surface
      // and most likely result in a dialog box and the app shutting down.
      throw err;
    }
  }
}

function finishConfiguringSettings(cfg: Settings, deploymentProfiles: DeploymentProfileType): Settings {
  if (process.env.RD_FORCE_UPDATES_ENABLED) {
    console.debug('updates enabled via RD_FORCE_UPDATES_ENABLED');
    cfg.application.updater.enabled = true;
  } else if (os.platform() === 'linux' && !process.env.APPIMAGE) {
    cfg.application.updater.enabled = false;
  } else {
    const appVersion = getProductionVersion();

    console.log(`appVersion is ${ appVersion }`);
    // Auto-update doesn't work for CI or local builds, so don't enable it by default.
    // CI builds use a version string like `git describe`, e.g. "v1.1.0-4140-g717225dc".
    // Versions like "1.9.0-tech-preview" are pre-releases and not CI builds, so should not disable auto-update.
    if (appVersion.match(/^v?\d+\.\d+\.\d+-\d+-g[0-9a-f]+$/) || appVersion.includes('?')) {
      cfg.application.updater.enabled = false;
      console.log('updates disabled');
    }
  }
  // Replace existing settings fields with whatever is set in the locked deployment-profile
  merge(cfg, deploymentProfiles.locked);
  save(cfg);
  // Update the global settings variable for later retrieval
  settings = cfg;

  return cfg;
}

export function getDefaultMemory() {
  if (os.platform() === 'darwin' || os.platform() === 'linux') {
    const totalMemoryInGB = os.totalmem() / 2 ** 30;

    // 25% of available ram up to a maximum of 6gb
    return Math.min(6, Math.round(totalMemoryInGB / 4.0));
  } else {
    return 2;
  }
}
/**
 * Merge settings in-place with changes, returning the merged settings.
 * @param cfg Baseline settings.  This will be modified.
 * @param changes The set of changes to pull in.
 * @returns The merged settings (also modified in-place).
 */
export function merge<T = Settings>(cfg: T, changes: RecursivePartial<RecursiveReadonly<T>>): T {
  const customizer = (objValue: any, srcValue: any) => {
    if (Array.isArray(objValue)) {
      // If the destination is a array of primitives, just return the source
      // (i.e. completely overwrite).
      if (objValue.every(i => typeof i !== 'object')) {
        return srcValue;
      }
    }
    if (typeof srcValue === 'object' && srcValue) {
      // For objects, setting a value to `undefined` will remove it.
      for (const [key, value] of Object.entries(srcValue)) {
        if (typeof value === 'undefined') {
          delete srcValue[key];
          if (typeof objValue === 'object' && objValue) {
            delete objValue[key];
          }
        }
      }
      // Don't return anything, let _.mergeWith() do the actual merging.
    }
  };

  return _.mergeWith(cfg, changes, customizer);
}

export function getLockedSettings(): LockedSettingsType {
  return lockedSettings;
}

export function updateLockedFields(lockedDeploymentProfile: RecursivePartial<Settings>) {
  lockedSettings = determineLockedFields(lockedDeploymentProfile);
}

/**
 * Returns an object that mirrors `lockedProfileSettings` but all leaves are `true`.
 * @param lockedProfileSettings
 */
export function determineLockedFields(lockedProfileSettings: LockedSettingsType): LockedSettingsType {
  function isLockedSettingsType(input: any): input is LockedSettingsType {
    return typeof input === 'object' && !Array.isArray(input) && input !== null;
  }

  return Object.fromEntries(Object.entries(lockedProfileSettings).map(([k, v]) => {
    return [k, isLockedSettingsType(v) ? determineLockedFields(v) : true];
  }));
}

export function firstRunDialogNeeded() {
  return _isFirstRun;
}

export function turnFirstRunOff() {
  _isFirstRun = false;
}

function safeFileTest(path: string, conditions: number) {
  try {
    fs.accessSync(path, conditions);

    return true;
  } catch (_) {
    return false;
  }
}

export function runInDebugMode(debug: boolean): boolean {
  return debug || !!process.env.RD_DEBUG_ENABLED;
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
 * Provide a mapping from settings version to a function used to update the
 * settings object to the next version.
 *
 * The main use-cases are for renaming property names, correct values that are
 * no longer valid, and removing obsolete entries. The final step merges in
 * current defaults, so we won't need an entry for every version change, as
 * most changes will get picked up from the defaults.
 */
const updateTable: Record<number, (settings: any) => void> = {
  1: (settings) => {
    // Implement setting change from version 3 to 4
    if ('rancherMode' in settings.kubernetes) {
      delete settings.kubernetes.rancherMode;
    }
  },
  2: (_) => {
    // No need to still check for and delete archaic installations from version 0.3.0
    // The updater still wants to see an entry here (for updating ancient systems),
    // but will no longer delete obsolete files.
  },
  3: (_) => {
    // With settings v5, all traces of the kim builder are gone now, so no need to update it.
  },
  4: (settings) => {
    settings.application = {
      adminAccess:            !settings.kubernetes.suppressSudo,
      debug:                  settings.debug,
      pathManagementStrategy: settings.pathManagementStrategy,
      telemetry:              { enabled: settings.telemetry },
      updater:                { enabled: settings.updater },
    };
    settings.virtualMachine = {
      hostResolver: settings.kubernetes.hostResolver,
      memoryInGB:   settings.kubernetes.memoryInGB,
      numberCPUs:   settings.kubernetes.numberCPUs,
    };
    settings.experimental = { virtualMachine: { socketVMNet: settings.kubernetes.experimental.socketVMNet } };
    settings.WSL = { integrations: settings.kubernetes.WSLIntegrations };
    settings.containerEngine.name = settings.kubernetes.containerEngine;

    delete settings.kubernetes.containerEngine;
    delete settings.kubernetes.experimental;
    delete settings.kubernetes.hostResolver;
    delete settings.kubernetes.checkForExistingKimBuilder;
    delete settings.kubernetes.memoryInGB;
    delete settings.kubernetes.numberCPUs;
    delete settings.kubernetes.suppressSudo;
    delete settings.kubernetes.WSLIntegrations;

    delete settings.debug;
    delete settings.pathManagementStrategy;
    delete settings.telemetry;
    delete settings.updater;
  },
  5: (settings) => {
    if (settings.containerEngine.imageAllowList) {
      settings.containerEngine.allowedImages = settings.containerEngine.imageAllowList;
      delete settings.containerEngine.imageAllowList;
    }
    if (settings.virtualMachine.experimental) {
      if ('socketVMNet' in settings.virtualMachine.experimental) {
        settings.experimental = { virtualMachine: { socketVMNet: settings.virtualMachine.experimental.socketVMNet } };
        delete settings.virtualMachine.experimental.socketVMNet;
      }
      delete settings.virtualMachine.experimental;
    }
    for (const field of ['autoStart', 'hideNotificationIcon', 'startInBackground', 'window']) {
      if (field in settings) {
        settings.application[field] = settings[field];
        delete settings[field];
      }
    }
  },
  6: (settings) => {
    // Rancher Desktop 1.9+
    // extensions went from Record<string, boolean> to Record<string, string>
    // The key used to be the extension image (including tag); it's now keyed
    // by the image (without tag) with the value being the tag.
    const withTags = Object.entries(settings.extensions ?? {}).filter(([, v]) => v).map(([k]) => k);
    const extensions = withTags.map((image) => {
      return image.split(':', 2).concat('latest').slice(0, 2) as [string, string];
    });

    settings.extensions = Object.fromEntries(extensions);
  },
  7: (settings) => {
    if (settings.application.pathManagementStrategy === 'notset') {
      if (process.platform === 'win32') {
        settings.application.pathManagementStrategy = PathManagementStrategy.Manual;
      } else {
        settings.application.pathManagementStrategy = PathManagementStrategy.RcFiles;
      }
    }
  },
  8: (settings) => {
    // Rancher Desktop 1.10: move .extensions to .application.extensions.installed
    if (settings.extensions) {
      settings.application ??= {};
      settings.application.extensions ??= {};
      settings.application.extensions.installed = settings.extensions;
      delete settings.extensions;
    }
  },
  9: (_) => {
    // On macOS, this version deletes credential-server.json and rd-engine.json from paths.appHome
    // This happens on startup, so new instances of these files will be created in paths.config
    // paths.config === paths.appHome on linux and Windows, so this only needs to be done on macOS
    if (process.platform === 'darwin') {
      for (const filename of ['credential-server.json', 'rd-engine.json']) {
        // Ignore nonexistent files (but if we're moving from settings 9 to 10 on macOS, they should exist
        fs.rmSync(join(paths.appHome, filename), { force: true });
      }
    }
  },
};

function migrateSettingsToCurrentVersion(settings: Settings) {
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

  if (!Object.values(ContainerEngine).map(String).includes(settings.containerEngine.name)) {
    console.warn(`Replacing unrecognized saved container engine pref of '${ settings.containerEngine.name }' with ${ ContainerEngine.CONTAINERD }`);
    settings.containerEngine.name = ContainerEngine.CONTAINERD;
  }

  return _.defaultsDeep(settings, defaultSettings);
}

// Imported from dashboard/config/settings.js
// Setting IDs
export const SETTING = { PL_RANCHER_VALUE: 'rancher' };
