// This file contains the code to work with the settings.json file along with
// code docs on it.

import fs from 'fs';
import os from 'os';
import { dirname, join } from 'path';

import _ from 'lodash';

import { PathManagementStrategy } from '@pkg/integrations/pathManager';
import clone from '@pkg/utils/clone';
import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';
import { RecursivePartial, RecursiveReadonly } from '@pkg/utils/typeUtils';
import { getProductionVersion } from '@pkg/utils/version';

const console = Logging.settings;

// Settings versions are independent of app versions.
// Any time a version changes, increment its version by 1.
// Adding a new setting usually doesn't require incrementing the version field, because
// it will be picked up from the default settings object.
// Version incrementing is for when a breaking change is introduced in the settings object.

export const CURRENT_SETTINGS_VERSION = 7 as const;

export enum VMType {
  QEMU = 'qemu',
  VZ = 'vz',
}
export enum ContainerEngine {
  NONE = '',
  CONTAINERD = 'containerd',
  MOBY = 'moby',
}

export const ContainerEngineNames: Record<ContainerEngine, string> = {
  [ContainerEngine.NONE]:       '',
  [ContainerEngine.CONTAINERD]: 'containerd',
  [ContainerEngine.MOBY]:       'dockerd',
};

export enum MountType {
  NINEP = '9p',
  REVERSE_SSHFS = 'reverse-sshfs',
  VIRTIOFS = 'virtiofs',
}

export enum ProtocolVersion {
  NINEP2000 = '9p2000',
  NINEP2000_U = '9p2000.u',
  NINEP2000_L = '9p2000.L',
}

export enum SecurityModel {
  PASSTHROUGH ='passthrough',
  MAPPED_XATTR = 'mapped-xattr',
  MAPPED_FILE = 'mapped-file',
  NONE = 'none',
}

export enum CacheMode {
  NONE = 'none',
  LOOSE = 'loose',
  FSCACHE = 'fscache',
  MMAP = 'mmap',
}

export const defaultSettings = {
  version:     CURRENT_SETTINGS_VERSION,
  application: {
    adminAccess:            true,
    debug:                  false,
    pathManagementStrategy: PathManagementStrategy.NotSet,
    telemetry:              { enabled: true },
    /** Whether we should check for updates and apply them. */
    updater:                { enabled: true },
    autoStart:              false,
    startInBackground:      false,
    hideNotificationIcon:   false,
    window:                 { quitOnClose: false },
  },
  containerEngine: {
    allowedImages: {
      enabled:  false,
      patterns: [] as Array<string>,
    },
    name: ContainerEngine.CONTAINERD,
  },
  virtualMachine: {
    memoryInGB:   2,
    numberCPUs:   2,
    /**
     * when set to true Dnsmasq is disabled and all DNS resolution
     * is handled by host-resolver on Windows platform only.
     */
    hostResolver: true,
  },
  WSL:        { integrations: {} as Record<string, boolean> },
  kubernetes: {
    /** The version of Kubernetes to launch, as a semver (without v prefix). */
    version: '',
    port:    6443,
    enabled: true,
    options: { traefik: true, flannel: true },
    ingress: { localhostOnly: false },
  },
  portForwarding: { includeKubernetesServices: false },
  images:         {
    showAll:   true,
    namespace: 'k8s.io',
  },
  diagnostics: {
    showMuted:   false,
    mutedChecks: {} as Record<string, boolean>,
  },
  /** Installed extensions, mapping to the installed version (tag). */
  extensions:   { } as Record<string, string>,
  /**
   * Experimental settings - there should not be any UI for these.
   */
  experimental: {
    virtualMachine: {
      /** can only be set to VMType.VZ on macOS Ventura and later */
      type:        VMType.QEMU,
      /** can only be used when type is VMType.VZ, and only on aarch64 */
      useRosetta:  false,
      /** macOS only: if set, use socket_vmnet instead of vde_vmnet. */
      socketVMNet: false,
      mount:       {
        type: MountType.REVERSE_SSHFS,
        '9p': {
          securityModel:   SecurityModel.NONE,
          protocolVersion: ProtocolVersion.NINEP2000_L,
          msizeInKB:       128,
          cacheMode:       CacheMode.MMAP,
        },
      },
      /** windows only: if set, use gvisor based network rather than host-resolver/dnsmasq. */
      networkingTunnel: false,
      proxy:            {
        enabled: false, address: '', password: '', port: 3128, username: '',
      },
    },
  },
};

export type Settings = typeof defaultSettings;

// A settings-like type with a subset of all of the fields of defaultSettings,
// but all leaves are set to `true`.
export type LockedSettingsType = Record<string, any>;
let lockedSettings: LockedSettingsType = {};

export interface DeploymentProfileType {
  defaults: RecursivePartial<Settings>;
  locked: RecursivePartial<Settings>;
}

let _isFirstRun = false;
let settings: Settings | undefined;

/**
 * Load the settings file from disk, doing any migrations as necessary.
 */
function loadFromDisk(): Settings {
  const rawdata = fs.readFileSync(join(paths.config, 'settings.json'));
  let settings;

  try {
    settings = JSON.parse(rawdata.toString());
  } catch {
    save(defaultSettings);

    return defaultSettings;
  }

  // clone settings because we check to see if the returned value is different
  const cfg = updateSettings(clone(settings));

  if (!Object.values(ContainerEngine).map(String).includes(cfg.containerEngine.name)) {
    console.warn(`Replacing unrecognized saved container engine pref of '${ cfg.containerEngine.name }' with ${ ContainerEngine.CONTAINERD }`);
    cfg.containerEngine.name = ContainerEngine.CONTAINERD;
    save(cfg);
  } else if (!_.isEqual(cfg, settings)) {
    save(cfg);
  }

  return cfg;
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

/**
 * Remove all stored settings.
 */
export async function clear() {
  // The node version packed with electron might not have fs.rm yet.
  await fs.promises.rm(paths.config, { recursive: true, force: true } as any);
}

/**
 * Load the settings file or create it if not present.  If the settings have
 * already been loaded, return it without re-loading from disk.
 */
export function load(deploymentProfiles: DeploymentProfileType): Settings {
  let setDefaultMemory = false;

  try {
    settings ??= loadFromDisk();
  } catch (err: any) {
    settings = clone(defaultSettings);
    if (err.code === 'ENOENT') {
      // If there is no settings file, use the contents of the selected defaults deployment profile.
      // Whether or not there's a settings file, give highest priority to any settings in the locked profile
      // (which is merged outside this if-block().
      //
      // The deployment profile always returns an empty object if there is no profile.
      // This means that we treat an empty hash defaults profile, or an empty registry hive,
      // as if there is no profile in place (for the purposes of setting the first-run entry).

      _.merge(settings, deploymentProfiles.defaults);
      if (Object.keys(deploymentProfiles.defaults).length || Object.keys(deploymentProfiles.locked).length) {
        // if there's a non-empty deployment profile, don't show the first-run dialog box (_isFirstRun is already false)
        if (!_.has(settings, 'virtualMachine.memoryInGB') && !_.has(deploymentProfiles.locked, 'virtualMachine.memoryInGB')) {
          setDefaultMemory = true;
        }
      } else {
        _isFirstRun = true;
        setDefaultMemory = true;
      }
    }
    if (setDefaultMemory && (os.platform() === 'darwin' || os.platform() === 'linux')) {
      const totalMemoryInGB = os.totalmem() / 2 ** 30;

      // 25% of available ram up to a maximum of 6gb
      settings.virtualMachine.memoryInGB = Math.min(6, Math.round(totalMemoryInGB / 4.0));
    }
  }
  if (os.platform() === 'linux' && !process.env['APPIMAGE']) {
    settings.application.updater.enabled = false;
  } else {
    const appVersion = getProductionVersion();

    console.log(`appVersion is ${ appVersion }`);
    // Auto-update doesn't work for CI or local builds, so don't enable it by default.
    // CI builds use a version string like `git describe`, e.g. "v1.1.0-4140-g717225dc".
    // Versions like "1.9.0-tech-preview" are pre-releases and not CI builds, so should not disable auto-update.
    if (appVersion.match(/^v?\d+\.\d+\.\d+-\d+-g[0-9a-f]+$/) || appVersion.includes('?')) {
      settings.application.updater.enabled = false;
      console.log('updates disabled');
    }
  }
  _.merge(settings, deploymentProfiles.locked);
  save(settings);
  lockedSettings = determineLockedFields(deploymentProfiles.locked);

  return settings;
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
