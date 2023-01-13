// This file contains the code to work with the settings.json file along with
// code docs on it.

import fs from 'fs';
import os from 'os';
import { dirname, join } from 'path';

import _ from 'lodash';

import { TransientSettings } from '@pkg/config/transientSettings';
import { PathManagementStrategy } from '@pkg/integrations/pathManager';
import clone from '@pkg/utils/clone';
import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';

const console = Logging.settings;

// Settings versions are independent of app versions.
// Any time a version changes, increment its version by 1.
// Adding a new setting usually doesn't require incrementing the version field, because
// it will be picked up from the default settings object.
// Version incrementing is for when a breaking change is introduced in the settings object.

const CURRENT_SETTINGS_VERSION = 5;

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

export const defaultSettings = {
  version:     CURRENT_SETTINGS_VERSION,
  application: {
    adminAccess:            true,
    debug:                  false,
    pathManagementStrategy: PathManagementStrategy.NotSet,
    telemetry:              { enabled: true },
    /** Whether we should check for updates and apply them. */
    updater:                { enabled: true },
  },
  containerEngine: {
    imageAllowList: {
      enabled:  false,
      /**
       *  List will be locked when patterns have been loaded from an admin controlled location.
       *  `enabled` will always be true when `locked` is true.
       */
      locked:   false,
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
    /**
     * Experimental settings - there should not be any UI for these.
     */
    experimental: {
      /** macOS only: if set, use socket_vmnet instead of vde_vmnet. */
      socketVMNet: false,
    },
  },
  WSL:        { integrations: {} as Record<string, boolean> },
  kubernetes: {
    /** The version of Kubernetes to launch, as a semver (without v prefix). */
    version: '',
    port:    6443,
    enabled: true,
    options: { traefik: true, flannel: true },
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
  autoStart:            false,
  startInBackground:    false,
  hideNotificationIcon: false,
  window:               { quitOnClose: false },
};

export type Settings = typeof defaultSettings;

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

/** Walks the settings object given a fully-qualified accessor,
 *  returning an updatable subtree of the settings object, along with the final subfield
 *  in the accessor.
 *
 *  Clients calling this routine expect to use it like so:
 *  ```
 *  const prefsTree = {a: {b: c: {d: 1, e: 2}}};
 *  const result = getUpdatableNode(prefsTree, 'a.b.c.d');
 *  expect(result).toEqual([{d: 1, e: 2}, 'd']);
 *  const [subtree, finalFieldName] = result;
 *  subtree[finalFieldName] = newValue;
 *  ```
 *  and update that part of the preferences Config.
 *
 *  `result` would be null if the accessor doesn't point to a node in the Settings subtree.
 *
 * @param cfg: the settings object
 * @param fqFieldAccessor: a multi-component dashed name representing a path to a node in the settings object.
 * @returns [internal node in cfg, final accessor name], or
 *          `null` if fqFieldAccessor doesn't point to a node in the settings tree.
 */
export function getUpdatableNode(cfg: Settings, fqFieldAccessor: string): [Record<string, any>, string] | null {
  const optionParts = fqFieldAccessor.split('.');
  const finalOptionPart = optionParts.pop() ?? '';
  let currentConfig: Record<string, any> = cfg;

  for (const field of optionParts) {
    currentConfig = currentConfig[field] || {};
  }

  return (finalOptionPart in currentConfig) ? [currentConfig, finalOptionPart] : null;
}
export function updateFromCommandLine(cfg: Settings, commandLineArgs: string[]): Settings {
  const lim = commandLineArgs.length;
  let processingExternalArguments = true;

  // As long as processingExternalArguments is true, ignore anything we don't recognize.
  // Once we see something that's "ours", set processingExternalArguments to false.
  // Note that `i` is also incremented in the body of the loop to skip over parameter values.
  for (let i = 0; i < lim; i++) {
    const arg = commandLineArgs[i];

    if (!arg.startsWith('--')) {
      if (processingExternalArguments) {
        continue;
      }
      throw new Error(`Unexpected argument '${ arg }' in command-line [${ commandLineArgs.join(' ') }]`);
    }
    const equalPosition = arg.indexOf('=');
    const [fqFieldName, value] = equalPosition === -1 ? [arg.substring(2), ''] : [arg.substring(2, equalPosition), arg.substring(equalPosition + 1)];

    if (fqFieldName === 'no-modal-dialogs') {
      switch (value) {
      case '':
      case 'true':
        TransientSettings.update({ noModalDialogs: true });
        break;
      case 'false':
        TransientSettings.update({ noModalDialogs: false });
        break;
      default:
        throw new Error(`Invalid associated value for ${ arg }: must be unspecified (set to true), true or false`);
      }
      processingExternalArguments = false;
      continue;
    }
    const lhsInfo = getUpdatableNode(cfg, fqFieldName);

    if (!lhsInfo) {
      if (processingExternalArguments) {
        continue;
      }
      throw new Error(`Can't evaluate command-line argument ${ arg } -- no such entry in current settings at ${ join(paths.config, 'settings.json') }`);
    }
    processingExternalArguments = false;
    const [lhs, finalFieldName] = lhsInfo;
    const currentValue = lhs[finalFieldName];
    const currentValueType = typeof currentValue;
    let finalValue: any = value;

    // First ensure we aren't trying to overwrite a non-leaf, and then determine the value to assign.
    switch (currentValueType) {
    case 'object':
      throw new Error(`Can't overwrite existing setting ${ arg } in current settings at ${ join(paths.config, 'settings.json') }`);
    case 'boolean':
      // --some-boolean-setting ==> --some-boolean-setting=true
      if (equalPosition === -1) {
        finalValue = 'true'; // JSON.parse to boolean `true` a few lines later.
      }
      break;
    default:
      if (equalPosition === -1) {
        if (i === lim - 1) {
          throw new Error(`No value provided for option ${ arg } in command-line [${ commandLineArgs.join(' ') }]`);
        }
        i += 1;
        finalValue = commandLineArgs[i];
      }
    }
    // Now verify we're not changing the type of the current value
    if (['boolean', 'number'].includes(currentValueType)) {
      try {
        finalValue = JSON.parse(finalValue);
      } catch (err) {
        throw new Error(`Can't evaluate --${ fqFieldName }=${ finalValue } as ${ currentValueType }: ${ err }`);
      }
      // We know the current value's type is either boolean or number, so a constrained comparison is ok
      // eslint-disable-next-line valid-typeof
      if (typeof finalValue !== currentValueType) {
        throw new TypeError(`Type of '${ finalValue }' is ${ typeof finalValue }, but current type of ${ fqFieldName } is ${ currentValueType } `);
      }
    }
    lhs[finalFieldName] = finalValue;
  }
  if (lim > 0) {
    save(cfg);
    _isFirstRun = false;
  }

  return cfg;
}
/**
 * Load the settings file or create it if not present.  If the settings have
 * already been loaded, return it without re-loading from disk.
 */
export function load(): Settings {
  try {
    settings ??= loadFromDisk();
  } catch (err: any) {
    settings = defaultSettings;
    if (err.code === 'ENOENT') {
      _isFirstRun = true;
      if (os.platform() === 'darwin' || os.platform() === 'linux') {
        const totalMemoryInGB = os.totalmem() / 2 ** 30;

        // 25% of available ram up to a maximum of 6gb
        settings.virtualMachine.memoryInGB = Math.min(6, Math.round(totalMemoryInGB / 4.0));
      }
    }
    if (os.platform() === 'linux' && !process.env['APPIMAGE']) {
      settings.application.updater.enabled = false;
    }
    save(settings);
  }

  return settings;
}

export function firstRunDialogNeeded() {
  return _isFirstRun;
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
  1: (settings: any) => {
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
    // With settings v5, all traces of the kim builder are gone now, so remove this line:
    // settings.kubernetes.checkForExistingKimBuilder = true;
  },
  4: (settings: any) => {
    settings.application = {
      adminAccess:            !settings.kubernetes.suppressSudo,
      debug:                  settings.debug,
      pathManagementStrategy: settings.pathManagementStrategy,
      telemetry:              { enabled: settings.telemetry },
      updater:                { enabled: settings.updater },
    };
    settings.virtualMachine = {
      experimental: settings.kubernetes.experimental,
      hostResolver: settings.kubernetes.hostResolver,
      memoryInGB:   settings.kubernetes.memoryInGB,
      numberCPUs:   settings.kubernetes.numberCPUs,
    };
    settings.WSL = { integrations: settings.kubernetes.WSLIntegrations };
    settings.containerEngine.name = settings.kubernetes.containerEngine;

    delete settings.kubernetes.containerEngine;
    delete settings.kubernetes.experimental;
    delete settings.kubernetes.hostResolver;
    delete settings.kubernetes.memoryInGB;
    delete settings.kubernetes.numberCPUs;
    delete settings.kubernetes.suppressSudo;
    delete settings.kubernetes.WSLIntegrations;

    delete settings.debug;
    delete settings.pathManagementStrategy;
    delete settings.telemetry;
    delete settings.updater;
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
