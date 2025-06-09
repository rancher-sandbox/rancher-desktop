// This file contains the code to work with the settings.json file along with
// code docs on it.

import fs from 'fs';
import os from 'os';
import { dirname, join } from 'path';

import _ from 'lodash';

import {
  CURRENT_SETTINGS_VERSION,
  defaultSettings,
  DeploymentProfileType,
  LockedSettingsType,
  Settings,
  SettingsError,
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
  const settingsPath = join(paths.config, 'settings.json');
  const rawdata = fs.readFileSync(settingsPath);
  let originalConfig: Record<string, any>;

  try {
    originalConfig = JSON.parse(rawdata.toString());
  } catch (err: any) {
    console.error(`Error JSON-parsing existing settings contents ${ rawdata }`, err);
    console.error('The old settings file will be replaced with the default settings.');

    return defaultSettings;
  }

  if (!('version' in originalConfig)) {
    throw new SettingsError(`No version specified in ${ settingsPath }`);
  }
  const updatedConfig = migrateSettingsToCurrentVersion(originalConfig);

  // If the existing settings file is partial, fill in the missing fields with defaults.
  return _.defaultsDeep(updatedConfig, defaultSettings);
}

export function save(cfg: Settings) {
  try {
    fs.mkdirSync(paths.config, { recursive: true });
    const rawdata = JSON.stringify(cfg);

    fs.writeFileSync(join(paths.config, 'settings.json'), rawdata);

    // update the in-memory copy so subsequent calls to getSettings() will
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
  try {
    return finishConfiguringSettings(loadFromDisk(), deploymentProfiles);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      // See the migrateSettingsLocationOnWindows code to understand how it's impossible to
      // end up in an infinite loop of recursive calls to `load()`
      if (migrateSettingsLocationOnWindows()) {
        return load(deploymentProfiles);
      }

      return createSettings(deploymentProfiles);
    } else {
      // JSON problems in the settings file will be caught, and we let any
      // other errors (e.g. permission-related) bubble up to the surface
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
      // If the destination is an array of primitives, just return the source
      // (i.e. completely overwrite).
      if (objValue.every(i => typeof i !== 'object')) {
        return srcValue;
      }
    }
    if (typeof srcValue === 'object' && srcValue) {
      // For objects, setting a value to `undefined` or `null` will remove it.
      for (const [key, value] of Object.entries(srcValue)) {
        if (typeof value === 'undefined' || value === null) {
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

/*
 * The purpose of this function is to let RD stop using AppData\Roaming on Windows, and store almost everything
 * in AppData\Local. The only file it needs to preserve is `AppData\Roaming\rancher-desktop\settings.json`.
 * This is called by the loader when it doesn't find that file in `Local\...`. So it looks to see if it's
 * in `Roaming\...`, and if it is, will move it to `Local\...` and then load it.
 */
function migrateSettingsLocationOnWindows(): boolean {
  if (process.platform !== 'win32') {
    return false;
  }
  const appData = process.env['APPDATA'];
  const rdAppHomeDir = paths.appHome;

  if (!appData || !rdAppHomeDir) {
    return false;
  }
  const oldConfigPath = join(appData, 'rancher-desktop', 'settings.json');
  const newConfigPath = join(rdAppHomeDir, 'settings.json');

  if (!fileExists(oldConfigPath) || fileExists(newConfigPath)) {
    return false;
  }
  try {
    fs.copyFileSync(oldConfigPath, newConfigPath);

    // If the copy actually failed to create `newConfigPath`, return false, so the caller will create new settings.
    return fileExists(newConfigPath);
  } catch {
    // Ignore any other problems, so create a new settings file.
  }

  return false;
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
 * ReplacementDirective describes how a setting can be migrated.
 */
interface ReplacementDirective {
  /**
   * The path to the old value
   */
  oldPath: string;
  /**
   * The path to the new value
   */
  newPath: string;
}

/**
 * This function takes an array of `ReplacementDirectives`, and carries out each one which essentially
 * moves a value at an old location to a new one, and then deletes the old location.
 * @param settings - the settings object
 * @param replacements - a table used to update the settings object based on existing obsolete fields that need to be moved.
 */
function processReplacements(settings: any, replacements: ReplacementDirective[]) {
  for (const { oldPath, newPath } of replacements) {
    if (_.hasIn(settings, oldPath)) {
      // Transfer the current value for the old field to the new field
      _.set(settings, newPath, _.get(settings, oldPath));
      // Delete the old field
      _.unset(settings, oldPath);
    }
  }
}

/**
 * Provide a mapping from settings version X to version X + 1
 *
 * Some migrations need to be done with bespoke code, but most of them
 * can be expressed in a descriptive table, and the operations are done
 * by `processReplacements`, which just moves old values to new locations,
 * and deletes the old location.
 *
 * The `settings` @param does not have to be a complete settings object.
 * And its type is `any` because it needs to work on older versions of the settings data.
 */
export const updateTable: Record<number, (settings: any, locked : boolean) => void> = {
  1: (settings) => {
    _.unset(settings, 'kubernetes.rancherMode');
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
    if (_.hasIn(settings, 'kubernetes.suppressSudo')) {
      _.set(settings, 'application.adminAccess', !settings.kubernetes.suppressSudo);
      delete settings.kubernetes.suppressSudo;
    }
    const replacements: ReplacementDirective[] = [
      { oldPath: 'debug', newPath: 'application.debug' },
      { oldPath: 'pathManagementStrategy', newPath: 'application.pathManagementStrategy' },
      { oldPath: 'telemetry', newPath: 'application.telemetry.enabled' },
      { oldPath: 'updater', newPath: 'application.updater.enabled' },
      { oldPath: 'kubernetes.containerEngine', newPath: 'containerEngine.name' },
      { oldPath: 'kubernetes.experimental.socketVMNet', newPath: 'experimental.virtualMachine.socketVMNet' },
      { oldPath: 'kubernetes.hostResolver', newPath: 'virtualMachine.hostResolver' },
      { oldPath: 'kubernetes.memoryInGB', newPath: 'virtualMachine.memoryInGB' },
      { oldPath: 'kubernetes.numberCPUs', newPath: 'virtualMachine.numberCPUs' },
      { oldPath: 'kubernetes.WSLIntegrations', newPath: 'WSL.integrations' },
    ];

    processReplacements(settings, replacements);
    _.unset(settings, 'kubernetes.checkForExistingKimBuilder');
    _.unset(settings, 'kubernetes.experimental');
  },
  5: (settings) => {
    const replacements: ReplacementDirective[] = [
      { oldPath: 'autoStart', newPath: 'application.autoStart' },
      { oldPath: 'hideNotificationIcon', newPath: 'application.hideNotificationIcon' },
      { oldPath: 'startInBackground', newPath: 'application.startInBackground' },
      { oldPath: 'window', newPath: 'application.window' },
      { oldPath: 'containerEngine.imageAllowList', newPath: 'containerEngine.allowedImages' },
      { oldPath: 'virtualMachine.experimental.socketVMNet', newPath: 'experimental.virtualMachine.socketVMNet' },
    ];

    processReplacements(settings, replacements);
    if (_.isEmpty(_.get(settings, 'virtualMachine.experimental'))) {
      _.unset(settings, 'virtualMachine.experimental');
    }
  },
  6: (settings) => {
    // Rancher Desktop 1.9+
    // extensions went from Record<string, boolean> to Record<string, string>
    // The key used to be the extension image (including tag); it's now keyed
    // by the image (without tag) with the value being the tag.
    if (_.hasIn(settings, 'extensions')) {
      const withTags = Object.entries(settings.extensions ?? {}).filter(([, v]) => v).map(([k]) => k);
      const extensions = withTags.map((image) => {
        return image.split(':', 2).concat('latest').slice(0, 2) as [string, string];
      });

      settings.extensions = Object.fromEntries(extensions);
    }
  },
  7: (settings) => {
    if (_.get(settings, 'application.pathManagementStrategy') === 'notset') {
      if (process.platform === 'win32') {
        settings.application.pathManagementStrategy = PathManagementStrategy.Manual;
      } else {
        settings.application.pathManagementStrategy = PathManagementStrategy.RcFiles;
      }
    }
  },
  8: (settings) => {
    // Rancher Desktop 1.10: move .extensions to .application.extensions.installed
    const replacements: ReplacementDirective[] = [
      { oldPath: 'extensions', newPath: 'application.extensions.installed' },
    ];

    processReplacements(settings, replacements);
  },
  9: (settings) => {
    // Rancher Desktop 1.11
    // Use string-list component instead of textarea for noproxy field. Blanks that
    // were accepted by the textarea need to be filtered out.
    if (!_.isEmpty(_.get(settings, 'experimental.virtualMachine.proxy.noproxy'))) {
      settings.experimental.virtualMachine.proxy.noproxy =
        settings.experimental.virtualMachine.proxy.noproxy.map((entry: string) => {
          return entry.trim();
        }).filter((entry: string) => {
          return entry.length > 0;
        });
    }
  },
  10: (settings, locked) => {
    // Migrating from an older locked profile automatically locks newer features (wasm support).
    if (locked && !_.has(settings, 'experimental.containerEngine.webAssembly.enabled')) {
      _.set(settings, 'experimental.containerEngine.webAssembly.enabled', false);
    }
  },
  11: (settings) => {
    _.unset(settings, 'experimental.virtualMachine.socketVMNet');
    if (_.isEmpty(_.get(settings, 'experimental.virtualMachine'))) {
      _.unset(settings, 'experimental.virtualMachine');
    }
  },
  12: (settings) => {
    // This bump is only there to force networking tunnel.
    _.set(settings, 'experimental.virtualMachine.networkingTunnel', true);
  },
  13: (settings) => {
    _.unset(settings, 'virtualMachine.hostResolver');
    _.unset(settings, 'experimental.virtualMachine.networkingTunnel');
  },
  14: (settings) => {
    const replacements: ReplacementDirective[] = [
      { oldPath: 'experimental.virtualMachine.type', newPath: 'virtualMachine.type' },
      { oldPath: 'experimental.virtualMachine.useRosetta', newPath: 'virtualMachine.useRosetta' },
    ];

    processReplacements(settings, replacements);
    if (_.isEmpty(_.get(settings, 'experimental.virtualMachine'))) {
      _.unset(settings, 'experimental.virtualMachine');
    }
  },
  15: (settings) => {
    const replacements: ReplacementDirective[] = [
      { oldPath: 'experimental.virtualMachine.mount.type', newPath: 'virtualMachine.mount.type' },
    ];

    processReplacements(settings, replacements);
  },
};

function migrateSettingsToCurrentVersion(settings: Record<string, any>): Settings {
  if (Object.keys(settings).length === 0) {
    return defaultSettings;
  }
  const newSettings = migrateSpecifiedSettingsToCurrentVersion(settings, false);

  return _.defaultsDeep(newSettings, defaultSettings);
}

/**
 * Used to migrate a settings payload from an earlier version to the current one.
 * Input payloads are expected to come from either the argument to `rdctl api settings -X PUT ...`
 * or a deployment profile.
 *
 * The contents of settings files go through the unexported function `migrateSettingsToCurrentVersion`
 * which assigns any missing defaults at the end. This function does not fill in missing values.
 * @param settings - a possibly partial settings object.
 * @param locked - perform special migrations for locked profiles.
 * @param targetVersion - used for unit testing, to run a specific step from version n to n + 1, and not the full migration
 */
export function migrateSpecifiedSettingsToCurrentVersion(settings: Record<string, any>, locked: boolean, targetVersion:number = CURRENT_SETTINGS_VERSION): RecursivePartial<Settings> {
  const firstPart = 'updating settings requires specifying an API version';
  let loadedVersion = settings.version;

  if (!('version' in settings)) {
    throw new TypeError(`${ firstPart }, but no version was specified`);
  } else if ((typeof (loadedVersion) !== 'number') || isNaN(loadedVersion)) {
    throw new TypeError(`${ firstPart }, but "${ loadedVersion }" is not a proper config version`);
  } else if (loadedVersion <= 0) {
    // Avoid someone specifying a number like -1000000000000 and burning CPU cycles in the loop below
    throw new TypeError(`${ firstPart }, but "${ loadedVersion }" is not a positive number`);
  } else if (loadedVersion >= targetVersion) {
    // This will elicit an error message from the validator
    return settings;
  }
  for (; loadedVersion < targetVersion; loadedVersion++) {
    if (updateTable[loadedVersion]) {
      updateTable[loadedVersion](settings, locked);
    }
  }
  settings.version = targetVersion;

  return settings;
}

// Imported from dashboard/config/settings.js
// Setting IDs
export const SETTING = { PL_RANCHER_VALUE: 'rancher' };
