// This file contains the code to work with the settings.json file along with
// code docs on it.

import fs from 'fs';
import os from 'os';
import { dirname, join } from 'path';

import _ from 'lodash';

import {
  CURRENT_SETTINGS_VERSION, defaultSettings, DeploymentProfileType,
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
      // If the destination is a array of primitives, just return the source
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

// @path {string} points to a possible field in the settings structure (I'm sure there's a typescript
// notation to describe it, but it's more readable in English than to try to come up with that incantation).
// `fn` {(string) => void} takes the old value, and knows what to do with it.  If it isn't specified, the
// function that works with this data will carry out a useful default action.
//
interface ReplacementDirective {
  path: string;
  fn?: null|((oldValue: any) => void);
}

/**
 * This function looks for existing fields in `settings`, and either calls the supplied function `fn` with the
 * existing value, or if no `fn` is specified, assigns the value to `settings[replacement][last-part-of-path]`.
 * See the arrays that are used to define the `replacements` arguments in the calls to this function as a reference.
 * @param settings - the settings object
 * @param replacements - a table used to update the settings object based on existing obsolete fields that need to be moved.
 *
 * There are three kinds of replacements (actually two, but one is a special case of the other).
 * In one of the cases, we specify a path and a replacement function -- if the path exists in the
 * current settings block, the callback is called with the paths' value, and the callback can do
 * whatever it needs to in order to move the value to a new place in the settings block.
 *
 * But there are many cases that fit a pattern, and no specific callback is needed. For example,
 * migration 4=>5 moves `settings.debug` and `settings.pathManagementStrategy` into `settings.application...`.
 * So the input to this function just specifies a parent entry of `application` for these two paths.
 * If `settings.debug` exists, it's moved into `settings.application.debug`.
 *
 * Some of the settings weren't at the top-level, such as `kubernetes.hostResalver`, which is moved into
 * `settings.virtualMachine`, also in migration 4=>5. This replacement looks a lot like the one for `settings.debug`,
 * except the new location is determined by the current parent in the migration table (`virtualMachine`), and
 * we take the last part of the dotted path, namely `hostResolver`. So we map `settings.kubernetes.hostResolver`
 * to `settings.virtualMachine.hostResolver` without needing a custom function.
 */
function processReplacements(settings: any, replacements: Record<string, ReplacementDirective[]>) {
  for (const replacement in replacements) {
    for (const { path, fn } of replacements[replacement]) {
      if (_.hasIn(settings, path)) {
        if (!_.hasIn(settings, replacement)) {
          _.set(settings, replacement, {});
        }
        if (fn) {
          fn(_.get(settings, path));
        } else {
          // `as string` maps `undefined|string` to `string`
          const lastPathPart: string = path.split('.').pop() as string;

          _.set(settings[replacement], lastPathPart, _.get(settings, path));
        }
        _.unset(settings, path);
      }
    }
  }
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
export const updateTable: Record<number, (settings: any) => void> = {
  1: (settings) => {
    // Implement setting change from version 3 to 4
    if (_.hasIn(settings, 'kubernetes.rancherMode')) {
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
    const replacements: Record<string, ReplacementDirective[]> = {
      application: [
        {
          path: 'kubernetes.suppressSudo',
          fn:   (oldValue: any) => {
            settings.application.adminAccess = !oldValue;
          },
        },
        { path: 'debug' },
        { path: 'pathManagementStrategy' },
        {
          path: 'telemetry',
          fn:   (oldValue: any) => {
            settings.application.telemetry = { enabled: oldValue };
          },
        },
        {
          path: 'updater',
          fn:   (oldValue: any) => {
            settings.application.updater = { enabled: oldValue };
          },
        },
      ],
      containerEngine: [
        {
          path: 'kubernetes.containerEngine',
          fn:   (oldValue: any) => {
            settings.containerEngine.name = oldValue;
          },
        },
      ],
      experimental: [
        {
          path: 'kubernetes.experimental.socketVMNet',
          fn:   (oldValue: any) => {
            _.set(settings, 'experimental.virtualMachine.socketVMNet', oldValue);
          },
        },
      ],
      virtualMachine: [
        { path: 'kubernetes.hostResolver' },
        { path: 'kubernetes.memoryInGB' },
        { path: 'kubernetes.numberCPUs' },
      ],
    };

    processReplacements(settings, replacements);
    if (_.hasIn(settings, 'kubernetes.WSLIntegrations')) {
      settings.WSL ??= {};
      settings.WSL = { integrations: settings.kubernetes.WSLIntegrations };
      delete settings.kubernetes.WSLIntegrations;
    }
    _.unset(settings, 'kubernetes.checkForExistingKimBuilder');
    _.unset(settings, 'kubernetes.experimental');
  },
  5: (settings) => {
    const replacements: Record<string, ReplacementDirective[]> = {
      application: [
        { path: 'autoStart' },
        { path: 'hideNotificationIcon' },
        { path: 'startInBackground' },
        { path: 'window' },
      ],
      containerEngine: [
        {
          path: 'containerEngine.imageAllowList',
          fn:   (oldValue: any) => {
            settings.containerEngine.allowedImages = oldValue;
          },
        },
      ],
      experimental: [
        {
          path: 'virtualMachine.experimental.socketVMNet',
          fn:   (oldValue: any) => {
            settings.experimental.virtualMachine ??= {};
            settings.experimental.virtualMachine.socketVMNet = oldValue;
          },
        },
      ],
    };

    processReplacements(settings, replacements);
    if (settings.virtualMachine?.experimental) {
      if (Object.keys(settings.virtualMachine.experimental).length === 0) {
        _.unset(settings, 'virtualMachine.experimental');
      }
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
    if (settings.extensions) {
      settings.application ??= {};
      settings.application.extensions ??= {};
      settings.application.extensions.installed = settings.extensions;
      delete settings.extensions;
    }
  },
  9: (settings) => {
    // Rancher Desktop 1.11
    // Use string-list component instead of textarea for noproxy field. Blanks that
    // were accepted by the textarea need to be filtered out.
    if (_.get(settings, 'experimental.virtualMachine.proxy.noproxy', '').length > 0) {
      settings.experimental.virtualMachine.proxy.noproxy =
        settings.experimental.virtualMachine.proxy.noproxy.map((entry: string) => {
          return entry.trim();
        }).filter((entry: string) => {
          return entry.length > 0;
        });
    }
  },
};

function migrateSettingsToCurrentVersion(settings: Record<string, any>): Settings {
  if (Object.keys(settings).length === 0) {
    return defaultSettings;
  }
  settings = migrateSpecifiedSettingsToCurrentVersion(settings) as Settings;
  // if (!Object.values(ContainerEngine).map(String).includes(settings.containerEngine.name)) {
  //   console.warn(`Replacing unrecognized saved container engine pref of '${ settings.containerEngine?.name }' with ${ ContainerEngine.CONTAINERD }`);
  //   settings.containerEngine.name = ContainerEngine.CONTAINERD;
  // }

  return _.defaultsDeep(settings, defaultSettings);
}

export function migrateSpecifiedSettingsToCurrentVersion(settings: Record<string, any>): RecursivePartial<Settings> {
  const firstPart = 'updating settings requires specifying an API version';
  let loadedVersion = settings.version;

  if (!('version' in settings)) {
    throw new TypeError(`${ firstPart }, but no version was specified`);
  } else if ((typeof (loadedVersion) !== 'number') || isNaN(loadedVersion)) {
    throw new TypeError(`${ firstPart }, but "${ loadedVersion }" is not a proper config version`);
  } else if (loadedVersion <= 0) {
    // Avoid someone specifying a number like -1000000000000 and burning CPU cycles in the loop below
    throw new TypeError(`${ firstPart }, but "${ loadedVersion }" is not a positive number`);
  } else if (loadedVersion >= CURRENT_SETTINGS_VERSION) {
    // This will elicit an error message from the validator
    return settings;
  }
  for (; loadedVersion < CURRENT_SETTINGS_VERSION; loadedVersion++) {
    if (updateTable[loadedVersion]) {
      updateTable[loadedVersion](settings);
    }
  }
  settings.version = CURRENT_SETTINGS_VERSION;

  return settings;
}

// Imported from dashboard/config/settings.js
// Setting IDs
export const SETTING = { PL_RANCHER_VALUE: 'rancher' };
