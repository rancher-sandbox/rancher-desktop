import fs from 'fs';
import os from 'os';
import { join } from 'path';
import stream from 'stream';

import * as nativeReg from 'native-reg';

import * as settings from '@pkg/config/settings';
import { spawnFile } from '@pkg/utils/childProcess';
import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';
import { RecursivePartial } from '@pkg/utils/typeUtils';

const console = Logging.deploymentProfile;

const REGISTRY_PATH_PROFILE = [
  ['SOFTWARE', 'Policies', 'Rancher Desktop'], // recommended profile location
  ['SOFTWARE', 'Rancher Desktop', 'Profile'], // backward compatible location
];

export class DeploymentProfileError extends Error {
}

/**
 * Lockable default settings used for validating deployment profiles.
 * Data values are ignored, but types are used for validation.
 */
const lockableDefaultSettings = {
  containerEngine: {
    allowedImages: {
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

export async function readDeploymentProfiles(): Promise<settings.DeploymentProfileType> {
  const profiles: settings.DeploymentProfileType = {
    defaults: {},
    locked:   {},
  };
  let defaults: undefined|RecursivePartial<settings.Settings>;
  let locked: undefined|RecursivePartial<settings.Settings>;

  switch (os.platform()) {
  case 'win32':
    for (const registryPath of REGISTRY_PATH_PROFILE) {
      for (const key of [nativeReg.HKLM, nativeReg.HKCU]) {
        const registryKey = nativeReg.openKey(key, registryPath.join('\\'), nativeReg.Access.READ);

        if (!registryKey) {
          continue;
        }
        const defaultsKey = nativeReg.openKey(registryKey, 'Defaults', nativeReg.Access.READ);
        const lockedKey = nativeReg.openKey(registryKey, 'Locked', nativeReg.Access.READ);

        try {
          if (defaultsKey) {
            defaults = readRegistryUsingSchema(settings.defaultSettings, defaultsKey) ?? {};
          }
          if (lockedKey) {
            locked = readRegistryUsingSchema(settings.defaultSettings, lockedKey) ?? {};
          }
        } catch (err) {
          console.error( `Error reading deployment profile: ${ err }`);
        } finally {
          nativeReg.closeKey(registryKey);
          if (defaultsKey) {
            nativeReg.closeKey(defaultsKey);
          }
          if (lockedKey) {
            nativeReg.closeKey(lockedKey);
          }
        }
        if ((defaults && Object.keys(defaults).length) || (locked && Object.keys(locked).length)) {
          break;
        }
      }

      // If we found something in the HKLM Defaults or Locked registry hive, don't look at the user's
      // Alternatively, if the keys work, we could break, even if both hives are empty.
      if ((defaults && Object.keys(defaults).length) || (locked && Object.keys(locked).length)) {
        break;
      }
    }
    break;
  case 'linux': {
    const linuxPaths = {
      [paths.deploymentProfileSystem]: ['defaults.json', 'locked.json'],
      [paths.deploymentProfileUser]:   ['rancher-desktop.defaults.json', 'rancher-desktop.locked.json'],
    };

    for (const configDir in linuxPaths) {
      const [defaultPath, lockedPath] = linuxPaths[configDir];

      [defaults, locked] = parseJsonFiles(configDir, defaultPath, lockedPath);
      if (typeof defaults !== 'undefined' || typeof locked !== 'undefined') {
        break;
      }
    }
  }
    break;
  case 'darwin':
    for (const rootPath of [paths.deploymentProfileSystem, paths.deploymentProfileUser]) {
      [defaults, locked] = await parseJsonFromPlists(rootPath, 'io.rancherdesktop.profile.defaults.plist', 'io.rancherdesktop.profile.locked.plist');

      if (typeof defaults !== 'undefined' || typeof locked !== 'undefined') {
        break;
      }
    }
    break;
  }

  profiles.defaults = validateDeploymentProfile(defaults, settings.defaultSettings, []) ?? {};
  profiles.locked = validateDeploymentProfile(locked, lockableDefaultSettings, []) ?? {};

  return profiles;
}

// This function can't call `plutil` directly with `inputPath`, because unit-testing mocks `fs.readFileSync`
// So read the text into a string variable, and have `plutil` read it via stdin.
// It's no error if a deployment profile doesn't exist.
// Any other error needs to show up in a dialog box and terminate processing.
async function convertAndParsePlist(inputPath: string): Promise<undefined|RecursivePartial<settings.Settings>> {
  let plutilResult: { stdout?: string, stderr?: string };
  let body: stream.Readable;
  const args = ['-convert', 'json', '-r', '-o', '-', '-'];
  const getErrorString = (error: any) => error.stdout || error.stderr || error.toString();

  try {
    body = stream.Readable.from(fs.readFileSync(inputPath, { encoding: 'utf-8' }));
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return;
    }
    console.log(`Error reading file ${ inputPath }\n${ error }`);
    throw new DeploymentProfileError(`Error reading file ${ inputPath }: ${ getErrorString(error) }`);
  }
  try {
    plutilResult = await spawnFile('plutil', args, { stdio: [body, 'pipe', 'pipe'] });
  } catch (error: any) {
    console.log(`Error parsing deployment profile plist file ${ inputPath }\n${ error }`);
    throw new DeploymentProfileError(`Error loading plist file ${ inputPath }: ${ getErrorString(error) }`);
  }

  try {
    return JSON.parse(plutilResult.stdout ?? '');
  } catch (error: any) {
    console.log(`Error parsing deployment profile JSON object ${ inputPath }\n${ error }`);
    throw new DeploymentProfileError(`Error parsing deployment profile JSON object from ${ inputPath }: ${ getErrorString(error) }`);
  }
}

/**
 * Read and parse plutil deployment profile files.
 * @param rootPath the system or user directory containing profiles.
 * @param defaultsPath the file path to the 'defaults' file.
 * @param lockedPath the file path to the 'locked' file.
 * @returns the defaults and/or locked objects if they exist, or
 *          throws an exception if there is an error parsing the locked file.
 */

async function parseJsonFromPlists(rootPath: string, defaultsPath: string, lockedPath: string): Promise<Array<undefined|RecursivePartial<settings.Settings>>> {
  return [
    await convertAndParsePlist(join(rootPath, defaultsPath)),
    await convertAndParsePlist(join(rootPath, lockedPath)),
  ];
}

/**
 * Read and parse deployment profile files.
 * @param rootPath the system or user directory containing profiles.
 * @param defaultsPath the file path to the 'defaults' file.
 * @param lockedPath the file path to the 'locked' file.
 * @returns the defaults and/or locked objects if they exist, or
 *          throws an exception if there is an error parsing the locked file.
 */
function parseJsonFiles(rootPath: string, defaultsPath: string, lockedPath: string): Array<undefined|RecursivePartial<settings.Settings>> {
  return [defaultsPath, lockedPath].map((configPath) => {
    const fullPath = join(rootPath, configPath);

    try {
      return JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
    } catch (ex: any) {
      if (ex.code !== 'ENOENT') {
        throw new DeploymentProfileError(`Error parsing deployment profile from ${ fullPath }: ${ ex }`);
      }
    }
  });
}

/**
 * Windows only. Read settings values from registry using schemaObj as a template.
 * @param schemaObj the object used as a template for navigating registry.
 * @param regKey the registry key obtained from nativeReg.openKey().
 * @returns null, or the registry data as an object.
 */
function readRegistryUsingSchema(schemaObj: any, regKey: nativeReg.HKEY): RecursivePartial<settings.Settings>|null {
  let newObject: RecursivePartial<settings.Settings>|null = null;

  const schemaKeys = Object.keys(schemaObj);
  // ignore case
  const registryKeys = nativeReg.enumKeyNames(regKey).concat(nativeReg.enumValueNames(regKey)).map(k => k.toLowerCase());
  const commonKeys = schemaKeys.filter(k => registryKeys.includes(k.toLowerCase()));

  for (const k of commonKeys) {
    const schemaVal = schemaObj[k];
    let regValue: any = null;

    if (typeof schemaVal === 'object') {
      if (!Array.isArray(schemaVal)) {
        const innerKey = nativeReg.openKey(regKey, k, nativeReg.Access.READ);

        if (!innerKey) {
          continue;
        }
        try {
          regValue = readRegistryUsingSchema(schemaVal, innerKey);
          if (regValue && (typeof regValue === 'object') && Object.keys(regValue).length === 0) {
            // Ignore empty objects
            regValue = null;
          }
        } finally {
          nativeReg.closeKey(innerKey);
        }
      } else {
        const multiSzValue = nativeReg.queryValueRaw(regKey, k);

        if (multiSzValue) {
          // Registry value can be a single-string or even a DWORD and parseMultiString will handle it.
          const arrayValue = nativeReg.parseMultiString(multiSzValue as nativeReg.Value);

          regValue = arrayValue.length ? arrayValue : null;
        }
      }
    } else {
      regValue = nativeReg.queryValue(regKey, k);
      if (typeof schemaVal === 'boolean') {
        if (typeof regValue === 'number') {
          regValue = regValue !== 0;
        } else {
          console.debug(`Deployment Profile expected boolean value for key ${ k }`);
          regValue = false;
        }
      }
    }
    if (regValue !== null) {
      newObject ??= {};
      (newObject as Record<string, any>)[k] = regValue;
    }
  }

  return newObject;
}

/**
 * Do simple type validation of a deployment profile
 * @param profile The profile to be validated
 * @param schema The structure (usually defaultSettings) used as a template
 * @param parentPathParts The parent path for the current schema key.
 * @returns The original profile, less any invalid fields
 */
function validateDeploymentProfile(profile: any, schema: any, parentPathParts: string[]) {
  if (typeof profile !== 'object') {
    return profile;
  }
  for (const key in profile) {
    if (!(key in schema)) {
      console.log(`Deployment Profile ignoring '${ parentPathParts.join('.') }.${ key }': not in schema.`);
      delete profile[key];
      continue;
    }
    if (typeof profile[key] !== 'object') {
      if (typeof profile[key] !== typeof schema[key]) {
        console.log(`Deployment Profile ignoring '${ parentPathParts.join('.') }.${ key }': expecting value of type ${ typeof schema[key] }, got ${ typeof profile[key] }.`);
        delete profile[key];
      }
    } else if (Array.isArray(profile[key])) {
      if (!Array.isArray(schema[key])) {
        console.log(`Deployment Profile ignoring '${ parentPathParts.join('.') }.${ key }': got an array, expecting type ${ typeof schema[key] }.`);
        delete profile[key];
      }
    } else if (isUserDefinedObject(parentPathParts, key)) {
      // Keep this part of the profile
    } else {
      // Finally recurse and compare the schema sub-object with the specified sub-object
      validateDeploymentProfile(profile[key], schema[key], parentPathParts.concat(key));
    }
  }

  return profile;
}

/**
 * A "user-defined object" from the schema's point of view is an object that contains user-defined keys.
 * For example, `WSL.integrations` points to a user-defined object, while
 * `WSL` alone points to an object that contains only one key, `integrations`.
 * @param pathParts
 * @param key
 * @returns boolean
 */
function isUserDefinedObject(pathParts: string[], key: string): boolean {
  if (pathParts.length > 3) {
    return false;
  }
  switch (pathParts.length) {
  case 0:
    return key === 'extensions';
  case 1:
    return ((key === 'integrations' && pathParts[0] === 'WSL') ||
      (key === 'mutedChecks' && pathParts[0] === 'diagnostics'));
  }

  return false;
}
