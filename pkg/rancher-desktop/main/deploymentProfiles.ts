import fs from 'fs';
import os from 'os';
import { join } from 'path';
import stream from 'stream';

import _ from 'lodash';
import * as nativeReg from 'native-reg';

import * as settings from '@pkg/config/settings';
import { spawnFile } from '@pkg/utils/childProcess';
import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';
import { RecursivePartial } from '@pkg/utils/typeUtils';

const console = Logging.deploymentProfile;

const REGISTRY_PATH_PROFILE = ['SOFTWARE', 'Rancher Desktop', 'Profile'];

export const testingDefaultsHiveName = 'DefaultsTest';
export const testingLockedHiveName = 'LockedTest';

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

const REGISTRY_PATH_PROFILE = ['SOFTWARE', 'Rancher Desktop', 'Profile'];

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

export async function readDeploymentProfiles(registryProfilePath = REGISTRY_PATH_PROFILE): Promise<settings.DeploymentProfileType> {
  if (process.platform === 'win32') {
    const win32DeploymentReader = new Win32DeploymentReader(registryProfilePath);

    return Promise.resolve(win32DeploymentReader.readProfile());
  }
  const profiles: settings.DeploymentProfileType = {
    defaults: {},
    locked:   {},
  };
  let defaults: undefined|RecursivePartial<settings.Settings>;
  let locked: undefined|RecursivePartial<settings.Settings>;

  switch (os.platform()) {
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
 * Win32DeploymentReader - encapsulate details about the registry in this class.
 */
class Win32DeploymentReader {
  protected registryPathProfile: string[];
  protected keyName = '';

  constructor(registryPathProfile: string[]) {
    this.registryPathProfile = registryPathProfile;
  }

  readProfile(): settings.DeploymentProfileType {
    const DEFAULTS_HIVE_NAME = 'Defaults';
    const LOCKED_HIVE_NAME = 'Locked';
    let defaults: RecursivePartial<settings.Settings> = {};
    let locked: RecursivePartial<settings.Settings> = {};

    for (const keyName of ['HKLM', 'HKCU'] as const) {
      this.keyName = keyName;
      const key = nativeReg[keyName];
      const registryKey = nativeReg.openKey(key, this.registryPathProfile.join('\\'), nativeReg.Access.READ);

      if (!registryKey) {
        continue;
      }
      const defaultsKey = nativeReg.openKey(registryKey, DEFAULTS_HIVE_NAME, nativeReg.Access.READ);
      const lockedKey = nativeReg.openKey(registryKey, LOCKED_HIVE_NAME, nativeReg.Access.READ);

      try {
        defaults = defaultsKey ? this.readRegistryUsingSchema(settings.defaultSettings, defaultsKey, [DEFAULTS_HIVE_NAME]) : {};
        locked = lockedKey ? this.readRegistryUsingSchema(settings.defaultSettings, lockedKey, [LOCKED_HIVE_NAME]) : {};
      } catch (err) {
        console.error('Error reading deployment profile: ', err);
      } finally {
        nativeReg.closeKey(registryKey);
        nativeReg.closeKey(defaultsKey);
        nativeReg.closeKey(lockedKey);
      }
      // If we found something in the HKLM Defaults or Locked registry hive, don't look at the user's
      // Alternatively, if the keys work, we could break, even if both hives are empty.
      if (Object.keys(defaults).length || Object.keys(locked).length) {
        break;
      }
    }

    // Don't bother with the validator, because the registry-based reader validates as it reads.
    return { defaults, locked };
  }

  protected fullRegistryPath(...pathParts: string[]): string {
    return `${ this.keyName }\\${ this.registryPathProfile.join('\\') }\\${ pathParts.join('\\') }`;
  }

  /**
   * Windows only. Read settings values from registry using schemaObj as a template.
   * @param schemaObj the object used as a template for navigating registry.
   * @param regKey the registry key obtained from nativeReg.openKey().
   * @param pathParts the relative path to the current registry key, starting at 'Defaults' or 'Locked'
   * @returns null, or the registry data as an object.
   */
  protected readRegistryUsingSchema(schemaObj: Record<string, any>, regKey: nativeReg.HKEY, pathParts: string[]): Record<string, any> {
    const newObject: Record<string, any> = {};
    const schemaKeys = Object.keys(schemaObj);
    const commonKeys: Array<{schemaKey: string, registryKey: string}> = [];
    const unknownKeys: string[] = [];
    const userDefinedObjectKeys: Array<{schemaKey: string, registryKey: string}> = [];
    let regValue: any;

    // Drop the initial 'defaults' or 'locked' field
    const pathPartsWithoutHiveType = pathParts.slice(1);

    for (const registryKey of nativeReg.enumKeyNames(regKey)) {
      const schemaKey = fixProfileKeyCase(registryKey, schemaKeys);
      // "fixed case" means mapping existing keys in the registry (which typically supports case-insensitive lookups)
      // to the actual case in the schema.

      if (schemaKey === null) {
        unknownKeys.push(registryKey);
      } else if (haveUserDefinedObject(pathPartsWithoutHiveType.concat(schemaKey))) {
        userDefinedObjectKeys.push({ schemaKey, registryKey });
      } else {
        commonKeys.push({ schemaKey, registryKey });
      }
    }
    if (unknownKeys.length) {
      unknownKeys.sort(caseInsensitiveComparator.compare);
      console.error(`Unrecognized keys in registry at ${ this.fullRegistryPath(...pathParts) }: [${ unknownKeys.join(', ') }]`);
    }

    // First process the nested keys, then process any values
    for (const { schemaKey, registryKey } of commonKeys) {
      const schemaVal = schemaObj[schemaKey];

      if ((typeof schemaVal) !== 'object' || schemaVal === null) {
        const valueType = schemaVal === null ? 'null' : (typeof schemaVal);

        console.error(`Expecting registry entry ${ this.fullRegistryPath(...pathParts, registryKey) } to be a ${ valueType }, but it's a registry object`);
        continue;
      }
      const innerKey = nativeReg.openKey(regKey, registryKey, nativeReg.Access.READ);

      if (!innerKey) {
        continue;
      }
      try {
        regValue = this.readRegistryUsingSchema(schemaVal, innerKey, pathParts.concat([schemaKey]));
      } finally {
        nativeReg.closeKey(innerKey);
      }
      if (Object.keys(regValue).length) {
        newObject[schemaKey] = regValue;
      }
    }
    for (const { schemaKey, registryKey } of userDefinedObjectKeys) {
      const innerKey = nativeReg.openKey(regKey, registryKey, nativeReg.Access.READ);

      if (innerKey === null) {
        console.error(`No value for registry object ${ this.fullRegistryPath(...pathParts, registryKey) }`);
        continue;
      }
      try {
        regValue = this.readRegistryObject(innerKey, pathParts.concat([schemaKey]), true);
      } catch (err: any) {
        console.error(`Error getting registry object for ${ this.fullRegistryPath(...pathParts, registryKey) }: `, err);
      } finally {
        nativeReg.closeKey(innerKey);
      }
      if (regValue) {
        newObject[schemaKey] = regValue;
      }
    }
    const unknownValueNames: string[] = [];

    for (const originalName of nativeReg.enumValueNames(regKey)) {
      const schemaKey = fixProfileKeyCase(originalName, schemaKeys);

      if (schemaKey === null) {
        unknownValueNames.push(originalName);
      } else {
        regValue = this.readRegistryValue(schemaObj[schemaKey], regKey, pathParts, originalName);
        if (regValue !== null) {
          newObject[schemaKey] = regValue;
        }
      }
    }
    if (unknownValueNames.length > 0) {
      unknownValueNames.sort(caseInsensitiveComparator.compare);
      console.error(`Unrecognized value names in registry at ${ this.fullRegistryPath(...pathParts) }: [${ unknownValueNames.join(', ') }]`);
    }

    return newObject;
  }

  protected readRegistryObject(regKey: nativeReg.HKEY, pathParts: string[], isUserDefinedObject = false) {
    const newObject: Record<string, string[] | string | boolean | number> = {};

    for (const k of nativeReg.enumValueNames(regKey)) {
      let newValue = this.readRegistryValue(undefined, regKey, pathParts, k, isUserDefinedObject);

      if (newValue !== null) {
        if (isUserDefinedObject && (typeof newValue) === 'number') {
          // Currently all user-defined objects are either
          // Record<string, string> or Record<string, boolean>
          // The registry can't store boolean values, only numbers, so we assume true and false
          // are stored as 1 and 0, respectively. Any other numeric values are considered errors.
          switch (newValue) {
          case 0:
            newValue = false;
            break;
          case 1:
            newValue = true;
            break;
          default:
            console.error(`Unexpected numeric value names in registry at ${ this.fullRegistryPath(...pathParts, k) } of ${ newValue }: expecting either 0 or 1`);
          }
        }
        newObject[k] = newValue;
      }
    }

    return newObject;
  }

  protected readRegistryValue(schemaVal: any, regKey: nativeReg.HKEY, pathParts: string[], valueName: string, isUserDefinedObject = false): string[] | string | boolean | number | null {
    const fullPath = `\\${ this.fullRegistryPath(...pathParts, valueName) }`;
    const valueTypeNames = [
      'NONE', // 0
      'SZ',
      'EXPAND_SZ',
      'BINARY',
      'DWORD',
      'DWORD_BIG_ENDIAN',
      'LINK',
      'MULTI_SZ',
      'RESOURCE_LIST',
      'FULL_RESOURCE_DESCRIPTOR',
      'RESOURCE_REQUIREMENTS_LIST',
      'QWORD',
    ];
    const rawValue = nativeReg.queryValueRaw(regKey, valueName);
    const parsedValueForErrorMessage = nativeReg.queryValue(regKey, valueName);

    if (rawValue === null) {
      // This shouldn't happen
      return null;
    } else if (!isUserDefinedObject && schemaVal && typeof schemaVal === 'object' && !Array.isArray(schemaVal)) {
      console.error(`Expecting registry entry ${ fullPath } to be a registry object, but it's a ${ valueTypeNames[rawValue.type] }, value: ${ parsedValueForErrorMessage }`);

      return null;
    }
    const expectingArray = Array.isArray(schemaVal);
    let parsedValue: any = null;

    switch (rawValue.type) {
    case nativeReg.ValueType.SZ:
      if (isUserDefinedObject || (typeof schemaVal) === 'string') {
        return nativeReg.parseString(rawValue);
      } else if (expectingArray) {
        return [nativeReg.parseString(rawValue)];
      } else {
        console.error(`Expecting registry entry ${ fullPath } to be a ${ typeof schemaVal }, but it's a ${ valueTypeNames[rawValue.type] }, value: ${ parsedValueForErrorMessage }`);
      }
      break;
    case nativeReg.ValueType.DWORD:
    case nativeReg.ValueType.DWORD_LITTLE_ENDIAN:
    case nativeReg.ValueType.DWORD_BIG_ENDIAN:
      if (expectingArray) {
        console.error(`Expecting registry entry ${ fullPath } to be an array, but it's a ${ valueTypeNames[rawValue.type] }, value: ${ parsedValueForErrorMessage }`);
      } else if (typeof schemaVal === 'string') {
        console.error(`Expecting registry entry ${ fullPath } to be a string, but it's a ${ valueTypeNames[rawValue.type] }, value: ${ parsedValueForErrorMessage }`);
      } else {
        parsedValue = nativeReg.parseValue(rawValue) as number;

        return (typeof schemaVal === 'boolean') ? !!parsedValue : parsedValue;
      }
      break;
    case nativeReg.ValueType.MULTI_SZ:
      if (expectingArray) {
        return nativeReg.parseMultiString(rawValue);
      } else if (typeof schemaVal === 'string') {
        console.error(`Expecting registry entry ${ fullPath } to be a single string, but it's an array of strings, value: ${ parsedValueForErrorMessage }`);
      } else {
        console.error(`Expecting registry entry ${ fullPath } to be a ${ typeof schemaVal }, but it's an array of strings, value: ${ parsedValueForErrorMessage }`);
      }
      break;
    default:
      console.error(`Unexpected registry entry ${ fullPath }: don't know how to process a registry entry of type ${ valueTypeNames[rawValue.type] }`);
    }

    return null;
  }
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
    } else if (haveUserDefinedObject(parentPathParts.concat(key))) {
      // Keep this part of the profile
    } else {
      // Finally recurse and compare the schema sub-object with the specified sub-object
      validateDeploymentProfile(profile[key], schema[key], parentPathParts.concat(key));
    }
  }

  return profile;
}

const caseInsensitiveComparator = new Intl.Collator('en', { sensitivity: 'base' });

function isEquivalentIgnoreCase(a: string, b: string): boolean {
  return caseInsensitiveComparator.compare(a, b) === 0;
}

function fixProfileKeyCase(key: string, schemaKeys: string[]): string|null {
  return schemaKeys.find(val => isEquivalentIgnoreCase(key, val)) ?? null;
}

const userDefinedKeys = [
  'extensions',
  'WSL.integrations',
  'diagnostics.mutedChecks',
].map(s => s.split('.'));

/**
 * A "user-defined object" from the schema's point of view is an object that contains user-defined keys.
 * For example, `WSL.integrations` points to a user-defined object, while
 * `WSL` alone points to an object that contains only one key, `integrations`.
 *
 * @param pathParts - On Windows, the parts of the registry path below KEY\Software\Rancher Desktop\Profile\{defaults|locked|}
 *                    The first field is always either 'defaults' or 'locked' and can be ignored
 *                    On other platforms its the path-parts up to but not including the root (which is unnamed anyway).
 * @returns boolean
 */
function haveUserDefinedObject(pathParts: string[]): boolean {
  return userDefinedKeys.some(userDefinedKey => _.isEqual(userDefinedKey, pathParts));
}

function isUserDefinedObjectIgnoreCase(pathParts: string[], key: string): boolean {
  key = key.toLowerCase();
  if (pathParts.length === 0) {
    return key === 'extensions';
  } else if (pathParts.length === 1) {
    const parentFieldName = pathParts[0].toLowerCase();

    return ((key === 'integrations' && parentFieldName === 'wsl') ||
      (key === 'mutedchecks' && parentFieldName === 'diagnostics'));
  }

  return false;
}
