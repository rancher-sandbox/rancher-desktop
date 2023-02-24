import fs from 'fs';
import os from 'os';
import { join } from 'path';
import timers from 'timers';

import * as nativeReg from 'native-reg';
import plist from 'plist';

import * as settings from '@pkg/config/settings';
import * as childProcess from '@pkg/utils/childProcess';
import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';

const console = Logging.background;

type BackgroundProcessConstructorOptions = {
  /** A function to create the underlying child process. */
  spawn: () => Promise<childProcess.ChildProcess>;
  /** Optional function to stop the underlying child process. */
  destroy?: (child: childProcess.ChildProcess) => Promise<void>;
  /** Additional checks to see if the process should be strarted. */
  shouldRun?: () => Promise<boolean>;
};

/**
 * This manages a given persistent background process that must be kept running
 * indefinitely (until stop is called).
 */
export default class BackgroundProcess {
  /**
   * The process being managed.
   */
  protected process: childProcess.ChildProcess | null = null;

  /**
   * A descriptive name of this process, for logging.
   */
  protected name: string;

  /**
   * A function which will spawn the process to be monitored.
   */
  protected spawn: BackgroundProcessConstructorOptions['spawn'];

  /** A function which will terminate the process. */
  protected destroy: Required<BackgroundProcessConstructorOptions>['destroy'];

  /** A function that provides an additional check if this process should run. */
  protected shouldRunCallback: Required<BackgroundProcessConstructorOptions>['shouldRun'];

  /**
   * Whether the process should be running.
   */
  protected started = false;

  /**
   * Timer used to restart the process;
   */
  protected timer: NodeJS.Timeout | null = null;

  /**
   * @param name A descriptive name of the process for logging.
   */
  constructor(name: string, options: BackgroundProcessConstructorOptions) {
    this.name = name;
    this.spawn = options.spawn;
    this.destroy = options.destroy ?? ((process) => {
      process?.kill('SIGTERM');

      return Promise.resolve();
    });
    this.shouldRunCallback = options.shouldRun ?? function() {
      return Promise.resolve(true);
    };
  }

  /**
   * Start the process asynchronously if it does not already exist, and attempt
   * to keep it running indefinitely.
   */
  start() {
    this.started = true;
    this.restart();
  }

  /**
   * Check if the process should be running at this point in time.
   */
  protected async shouldRun() {
    return this.started && await this.shouldRunCallback();
  }

  /**
   * Attempt to start the process once.
   */
  protected async restart() {
    if (!await this.shouldRun()) {
      console.debug(`Not restarting ${ this.name } because shouldRun is ${ this.shouldRun }`);
      await this.stop();

      return;
    }
    if (this.process) {
      await this.destroy(this.process);
    }
    if (this.timer) {
      // Ideally, we should use this.timer.refresh(); however, it does not
      // appear to actually trigger.
      timers.clearTimeout(this.timer);
      this.timer = null;
    }
    console.log(`Launching background process ${ this.name }.`);
    const process = await this.spawn();

    this.process = process;
    process.on('exit', (status, signal) => {
      if ([0, null].includes(status) && ['SIGTERM', null].includes(signal)) {
        console.log(`Background process ${ this.name } exited gracefully.`);
      } else {
        console.log(`Background process ${ this.name } exited with status ${ status } signal ${ signal }`);
      }
      if (!Object.is(process, this.process)) {
        console.log(`Not current ${ this.name } process; nothing to be done.`);

        return;
      }
      this.shouldRun().then((result) => {
        if (result) {
          this.timer = timers.setTimeout(this.restart.bind(this), 1_000);
          console.debug(`Background process ${ this.name } will restart.`);
        }
      }).catch(console.error);
    });
  }

  /**
   * Stop the process and do not restart it.
   */
  async stop() {
    console.log(`Stopping background process ${ this.name }.`);
    this.started = false;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    if (this.process) {
      await this.destroy(this.process);
    }
  }
}

const REGISTRY_PATH_PROFILE = ['SOFTWARE', 'Rancher Desktop', 'Profile'];

/**
 * Lockable default settings used for validating deployment profiles.
 * Data values are ignored, but types are used for validation.
 */
const lockableDefaultSettings = {
  containerEngine: {
    imageAllowList: {
      enabled:  true,
      patterns: [] as Array<string>,
    },
  },
};

/**
 * Read and validate deployment profiles, giving system level profiles
 * priority over user level profiles.  If the system directory contains a
 * defaults or locked profile, the user directory will not be read.
 * @returns type validated defaults and locked deployment profiles, and throws
 *          an error if there is an error parsing the locked profile.
 * NOTE: The renderer process can not access the 'native-reg' library, so the
 *       win32 portions of the deployment profile reader functions must be
 *       located in the main process.
 */

export function readDeploymentProfiles() {
  let profiles = {
    defaults: undefined,
    locked:   undefined,
  };

  switch (os.platform()) {
  case 'win32':
    for (const key of [nativeReg.HKLM, nativeReg.HKCU]) {
      const registryKey = nativeReg.openKey(key, REGISTRY_PATH_PROFILE.join('\\'), nativeReg.Access.READ);

      try {
        if (registryKey !== null) {
          profiles.defaults = readRegistryUsingSchema(settings.defaultSettings, registryKey, ['Defaults']);
          profiles.locked = readRegistryUsingSchema(settings.defaultSettings, registryKey, ['Locked']);
        }
      } catch (err) {
        console.error( `Error reading deployment profile: ${ err }`);
      } finally {
        if (typeof registryKey !== 'undefined') {
          nativeReg.closeKey(registryKey);
        }
      }
      if (typeof profiles.defaults !== 'undefined' || typeof profiles.locked !== 'undefined') {
        break;
      }
    }
    break;
  case 'linux':
    for (const rootPath of [paths.deploymentProfileSystem, paths.deploymentProfileUser]) {
      profiles = readProfileFiles(rootPath, 'defaults.json', 'locked.json', JSON);

      if (typeof profiles.defaults !== 'undefined' || typeof profiles.locked !== 'undefined') {
        break;
      }
    }
    break;
  case 'darwin':
    for (const rootPath of [paths.deploymentProfileSystem, paths.deploymentProfileUser]) {
      profiles = readProfileFiles(rootPath, 'io.rancherdesktop.profile.defaults.plist', 'io.rancherdesktop.profile.locked.plist', plist);

      if (typeof profiles.defaults !== 'undefined' || typeof profiles.locked !== 'undefined') {
        break;
      }
    }
    break;
  }

  profiles.defaults = validateDeploymentProfile(profiles.defaults, settings.defaultSettings) ?? {};
  profiles.locked = validateDeploymentProfile(profiles.locked, lockableDefaultSettings) ?? {};

  return profiles;
}

/**
 * Read and parse deployment profile files.
 * @param rootPath the system or user directory containing profiles.
 * @param defaultsPath the file path to the 'defaults' file.
 * @param lockedPath the file path to the 'locked' file.
 * @param parser the parser (JSON or plist) for parsing the files read.
 * @returns the defaults and/or locked objects if they exist, or
 *          throws an exception if there is an error parsing the locked file.
 */
function readProfileFiles(rootPath: string, defaultsPath: string, lockedPath: string, parser: any) {
  let defaults;
  let locked;

  try {
    const defaultsData = fs.readFileSync(join(rootPath, defaultsPath), 'utf8');

    defaults = parser.parse(defaultsData);
  } catch {}
  try {
    const lockedData = fs.readFileSync(join(rootPath, lockedPath), 'utf8');

    locked = parser.parse(lockedData);
  } catch (ex: any) {
    if (ex.code !== 'ENOENT') {
      throw new Error(`Error parsing locked deployment profile: ${ ex }`);
    }
  }

  return { defaults, locked };
}

/**
 * Windows only. Read settings values from registry using schemaObj as a template.
 * @param schemaObj the object used as a template for navigating registry.
 * @param regKey the registry key obtained from nativeReg.openKey().
 * @param regPath the path to the object relative to regKey.
 * @returns undefined, or the registry data as an object.
 */
function readRegistryUsingSchema(schemaObj: any, regKey: nativeReg.HKEY, regPath: string[]): any {
  let regValue;
  let newObject: any;

  for (const [schemaKey, schemaVal] of Object.entries(schemaObj)) {
    if (typeof schemaVal === 'object' && !Array.isArray(schemaVal)) {
      regValue = readRegistryUsingSchema(schemaVal, regKey, regPath.concat(schemaKey));
    } else {
      regValue = nativeReg.getValue(regKey, regPath.join('\\'), schemaKey);
    }

    if (typeof regValue !== 'undefined' && regValue !== null) {
      newObject ??= {};
      if (typeof schemaVal === 'boolean') {
        if (typeof regValue === 'number') {
          regValue = regValue !== 0;
        } else {
          console.debug(`Deployment Profile expected boolean value for ${ regPath.concat(schemaKey) }`);
          regValue = false;
        }
      }
      newObject[schemaKey] = regValue;
    }
  }

  return newObject;
}

/**
 * Do simple type validation of a deployment profile
 * @param profile The profile to be validated
 * @param schema The structure (usually defaultSettings) used as a template
 * @returns The original profile, less any invalid fields
 */
function validateDeploymentProfile(profile: any, schema: any) {
  if (typeof profile === 'object') {
    for (const key in profile) {
      if (key in schema) {
        if (typeof profile[key] === typeof schema[key]) {
          if (typeof profile[key] === 'object') {
            if (Array.isArray(profile[key] !== Array.isArray(schema[key]))) {
              console.log(`Deployment Profile ignoring '${ key }'. Array type mismatch.`);
              delete profile[key];
            } else if (!Array.isArray(profile[key])) {
              validateDeploymentProfile(profile[key], schema[key]);
            }
          }
        } else {
          console.log(`Deployment Profile ignoring '${ key }'. Wrong type.`);
          delete profile[key];
        }
      } else {
        console.log(`Deployment Profile ignoring '${ key }'. Not in schema.`);
        delete profile[key];
      }
    }
  }

  return profile;
}
