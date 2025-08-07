import fs from 'fs';
import os from 'os';
import { join } from 'path';
import stream from 'stream';

import _ from 'lodash';
import * as nativeReg from 'native-reg';

import * as settings from '@pkg/config/settings';
import * as settingsImpl from '@pkg/config/settingsImpl';
import { spawnFile } from '@pkg/utils/childProcess';
import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';
import { RecursivePartial } from '@pkg/utils/typeUtils';

const console = Logging.deploymentProfile;

export class DeploymentProfileError extends Error {
  toString() {
    // This is needed on linux. Without it, we get a randomish replacement
    // for 'DeploymentProfileError' (like 'ys Error')
    return `DeploymentProfileError: ${ this.message }`;
  }
}

const REGISTRY_PROFILE_PATHS = [
  ['SOFTWARE', 'Policies', 'Rancher Desktop'], // Recommended (default) location
  ['SOFTWARE', 'Rancher Desktop', 'Profile'], // Old location for backward-compatibility
];

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

export async function readDeploymentProfiles(registryProfilePath = REGISTRY_PROFILE_PATHS): Promise<settings.DeploymentProfileType> {
  if (process.platform === 'win32') {
    const win32DeploymentReader = new Win32DeploymentReader(registryProfilePath);

    return Promise.resolve(win32DeploymentReader.readProfile());
  }
  const profiles: settings.DeploymentProfileType = {
    defaults: {},
    locked:   {},
  };
  let defaults: undefined | RecursivePartial<settings.Settings>;
  let locked: undefined | RecursivePartial<settings.Settings>;
  let fullDefaultPath = '';
  let fullLockedPath = '';

  switch (os.platform()) {
  case 'linux': {
    const linuxPaths = {
      [paths.deploymentProfileSystem]: ['defaults.json', 'locked.json'],
      // The altDeploymentProfileSystem path is the same as deploymentProfileSystem.
      [paths.deploymentProfileUser]:   ['rancher-desktop.defaults.json', 'rancher-desktop.locked.json'],
    };

    for (const configDir in linuxPaths) {
      const [defaultPath, lockedPath] = linuxPaths[configDir];

      [defaults, locked] = parseJsonFiles(configDir, defaultPath, lockedPath);
      fullDefaultPath = join(configDir, defaultPath);
      fullLockedPath = join(configDir, lockedPath);
      if (typeof defaults !== 'undefined' || typeof locked !== 'undefined') {
        break;
      }
    }
    break;
  }

  case 'darwin':
    for (const rootPath of [paths.deploymentProfileSystem, paths.altDeploymentProfileSystem, paths.deploymentProfileUser]) {
      [defaults, locked] = await parseJsonFromPlists(rootPath, 'io.rancherdesktop.profile.defaults.plist', 'io.rancherdesktop.profile.locked.plist');
      fullDefaultPath = join(rootPath, 'io.rancherdesktop.profile.defaults.plist');
      fullLockedPath = join(rootPath, 'io.rancherdesktop.profile.locked.plist');
      if (typeof defaults !== 'undefined' || typeof locked !== 'undefined') {
        break;
      }
    }
    break;
  }
  if (defaults) {
    if (!('version' in defaults)) {
      throw new DeploymentProfileError(`Invalid deployment file ${ fullDefaultPath }: no version specified. You'll need to add a version field to make it valid (current version is ${ settings.CURRENT_SETTINGS_VERSION }).`);
    }
    defaults = settingsImpl.migrateSpecifiedSettingsToCurrentVersion(defaults, false);
  }
  if (locked) {
    if (!('version' in locked)) {
      throw new DeploymentProfileError(`Invalid deployment file ${ fullLockedPath }: no version specified. You'll need to add a version field to make it valid (current version is ${ settings.CURRENT_SETTINGS_VERSION }).`);
    }
    locked = settingsImpl.migrateSpecifiedSettingsToCurrentVersion(locked, true);
  }

  profiles.defaults = validateDeploymentProfile(fullDefaultPath, defaults, settings.defaultSettings, []) ?? {};
  profiles.locked = validateDeploymentProfile(fullLockedPath, locked, settings.defaultSettings, []) ?? {};

  return profiles;
}

// This function can't call `plutil` directly with `inputPath`, because unit-testing mocks `fs.readFileSync`
// So read the text into a string variable, and have `plutil` read it via stdin.
// It's no error if a deployment profile doesn't exist.
// Any other error needs to show up in a dialog box and terminate processing.
async function convertAndParsePlist(inputPath: string): Promise<undefined | RecursivePartial<settings.Settings>> {
  let plutilResult: { stdout?: string, stderr?: string };
  let body: stream.Readable;
  const args = ['-convert', 'json', '-r', '-o', '-', '-'];
  const getErrorString = (error: any) => error.stdout || error.stderr || error.toString();

  try {
    body = stream.Readable.from(fs.readFileSync(inputPath));
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
    console.log(`Error parsing deployment profile plist file ${ inputPath }`, error);
    const msg = `Error loading plist file ${ inputPath }: ${ getErrorString(error) }`;

    throw new DeploymentProfileError(msg);
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

async function parseJsonFromPlists(rootPath: string, defaultsPath: string, lockedPath: string): Promise<(undefined | RecursivePartial<settings.Settings>)[]> {
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
function parseJsonFiles(rootPath: string, defaultsPath: string, lockedPath: string): (undefined | RecursivePartial<settings.Settings>)[] {
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
  protected registryPathProfiles: string[][];
  protected registryPathCurrent:  string[];
  protected keyName = '';
  protected errors:               string[] = [];

  constructor(registryPathProfiles: string[][]) {
    this.registryPathProfiles = registryPathProfiles;
    this.registryPathCurrent = [];
  }

  readProfile(): settings.DeploymentProfileType {
    const DEFAULTS_HIVE_NAME = 'Defaults';
    const LOCKED_HIVE_NAME = 'Locked';
    let defaults: RecursivePartial<settings.Settings> = {};
    let locked: RecursivePartial<settings.Settings> = {};

    this.errors = [];
    for (this.registryPathCurrent of this.registryPathProfiles) {
      for (const keyName of ['HKLM', 'HKCU'] as const) {
        this.keyName = keyName;
        const key = nativeReg[keyName];
        const registryKey = nativeReg.openKey(key, this.registryPathCurrent.join('\\'), nativeReg.Access.READ);

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

        // Don't bother with the validator, because the registry-based reader validates as it reads.
        if (this.errors.length) {
          throw new DeploymentProfileError(`Error in registry settings:\n${ this.errors.join('\n') }`);
        }

        // If we found something in the HKLM Defaults or Locked registry hive, don't look at the user's
        // Alternatively, if the keys work, we could break, even if both hives are empty.
        if (!_.isEmpty(defaults) || !_.isEmpty(locked)) {
          if (!_.isEmpty(defaults)) {
            if (!('version' in defaults)) {
              const registryPath = [keyName, ...this.registryPathCurrent, DEFAULTS_HIVE_NAME].join('\\');

              throw new DeploymentProfileError(`Invalid default-deployment: no version specified at ${ registryPath }. You'll need to add a version field to make it valid (current version is ${ settings.CURRENT_SETTINGS_VERSION }).`);
            }
            defaults = settingsImpl.migrateSpecifiedSettingsToCurrentVersion(defaults, false);
          }
          if (!_.isEmpty(locked)) {
            if (!('version' in locked)) {
              const registryPath = [keyName, ...this.registryPathCurrent, LOCKED_HIVE_NAME].join('\\');

              throw new DeploymentProfileError(`Invalid locked-deployment: no version specified at ${ registryPath }. You'll need to add a version field to make it valid (current version is ${ settings.CURRENT_SETTINGS_VERSION }).`);
            }
            locked = settingsImpl.migrateSpecifiedSettingsToCurrentVersion(locked, true);
          }

          return { defaults, locked };
        }
      }
    }

    return { defaults, locked };
  }

  protected fullRegistryPath(...pathParts: string[]): string {
    return `${ this.keyName }\\${ this.registryPathCurrent.join('\\') }\\${ pathParts.join('\\') }`;
  }

  protected msgFieldExpectingReceived(field: string, expected: string, received: string) {
    return `Error for field '${ field }': expecting ${ expected }, got ${ received }`;
  }

  protected msgFieldExpectingTypeReceived(field: string, expectedType: string, received: string) {
    return this.msgFieldExpectingReceived(field, `value of type ${ expectedType }`, received);
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
    const commonKeys: { schemaKey: string, registryKey: string }[] = [];
    const unknownKeys: string[] = [];
    const userDefinedObjectKeys: { schemaKey: string, registryKey: string }[] = [];
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
        const msg = this.msgFieldExpectingTypeReceived(this.fullRegistryPath(...pathParts, registryKey), valueType, 'a registry object');

        console.error(msg);
        this.errors.push(msg);
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
        const msg = `Error getting registry object for ${ this.fullRegistryPath(...pathParts, registryKey) }`;

        console.error(msg, err);
        this.errors.push(msg);
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
          default: {
            const msg = this.msgFieldExpectingTypeReceived(this.fullRegistryPath(...pathParts), 'boolean', `'${ newValue }'`);

            console.error(msg);
            this.errors.push(msg);
          }
          }
        }
        newObject[k] = newValue;
      }
    }

    return newObject;
  }

  protected readRegistryValue(schemaVal: any, regKey: nativeReg.HKEY, pathParts: string[], valueName: string, isUserDefinedObject = false): string[] | string | boolean | number | null {
    const fullPath = `${ this.fullRegistryPath(...pathParts, valueName) }`;
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
    let parsedValueForErrorMessage = nativeReg.queryValue(regKey, valueName);

    try {
      parsedValueForErrorMessage = JSON.stringify(parsedValueForErrorMessage);
    } catch { }

    if (rawValue === null) {
      // This shouldn't happen
      return null;
    } else if (!isUserDefinedObject && schemaVal && typeof schemaVal === 'object' && !Array.isArray(schemaVal)) {
      const msg = this.msgFieldExpectingTypeReceived(fullPath, 'object', `a ${ valueTypeNames[rawValue.type] }, value: '${ parsedValueForErrorMessage }'`);

      console.error(msg);
      this.errors.push(msg);

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
        const msg = this.msgFieldExpectingTypeReceived(fullPath, typeof schemaVal, `'${ parsedValueForErrorMessage }'`);

        console.error(msg);
        this.errors.push(msg);
      }
      break;
    case nativeReg.ValueType.DWORD:
    case nativeReg.ValueType.DWORD_LITTLE_ENDIAN:
    case nativeReg.ValueType.DWORD_BIG_ENDIAN:
      if (expectingArray) {
        const msg = this.msgFieldExpectingTypeReceived(fullPath, 'array', `'${ parsedValueForErrorMessage }'`);

        console.error(msg);
        this.errors.push(msg);
      } else if (isUserDefinedObject || (typeof schemaVal) === 'boolean' || (typeof schemaVal) === 'number') {
        // Otherwise the schema type is number or boolean. If it's boolean, reduce it to true/false
        parsedValue = nativeReg.parseValue(rawValue) as number;

        return (typeof schemaVal === 'boolean') ? !!parsedValue : parsedValue;
      } else {
        const msg = this.msgFieldExpectingTypeReceived(fullPath, typeof schemaVal, `'${ parsedValueForErrorMessage }'`);

        console.error(msg);
        this.errors.push(msg);
      }
      break;
    case nativeReg.ValueType.MULTI_SZ:
      if (expectingArray) {
        return nativeReg.parseMultiString(rawValue);
      } else {
        const msg = this.msgFieldExpectingTypeReceived(fullPath, typeof schemaVal, `an array '${ parsedValueForErrorMessage }'`);

        console.error(msg);
        this.errors.push(msg);
      }
      break;
    default: {
      const msg = `Error for field '${ fullPath }': don't know how to process a registry entry of type ${ valueTypeNames[rawValue.type] }`;

      console.error(msg);
      this.errors.push(msg);
    }
    }

    return null;
  }
}

/**
 * Do simple type validation of a deployment profile
 * @param inputPath Used for error messages only
 * @param profile The profile to be validated
 * @param schema The structure (usually defaultSettings) used as a template
 * @param parentPathParts The parent path for the current schema key.
 * @returns The original profile, less any invalid fields
 */
export function validateDeploymentProfile(inputPath: string, profile: any, schema: any, parentPathParts: string[]): RecursivePartial<settings.Settings> {
  const errors: string[] = [];

  validateDeploymentProfileWithErrors(profile, errors, schema, parentPathParts);
  if (errors.length) {
    throw new DeploymentProfileError(`Error in deployment file ${ inputPath }:\n${ errors.join('\n') }`);
  }

  return profile;
}

/**
 * Do simple type validation of a deployment profile
 * @param profile The profile to be validated, modified in place
 * @param errors An array of error messages, built up in place
 * @param schema The structure (usually defaultSettings) used as a template
 * @param parentPathParts The parent path for the current schema key.
 * @returns The original profile, less any invalid fields
 */
function validateDeploymentProfileWithErrors(profile: any, errors: string[], schema: any, parentPathParts: string[]) {
  if (typeof profile !== 'object') {
    return profile;
  }
  const fullPath = (key: string) => {
    return [...parentPathParts, key].join('.');
  };

  for (const key in profile) {
    if (!(key in schema)) {
      console.log(`Deployment Profile ignoring '${ fullPath(key) }': not in schema.`);
      delete profile[key];
      continue;
    }
    const schemaVal = schema[key];
    const profileVal = profile[key];

    if (Array.isArray(profileVal) || Array.isArray(schemaVal)) {
      if (Array.isArray(profileVal) !== Array.isArray(schemaVal)) {
        if (Array.isArray(schemaVal)) {
          errors.push(`Error for field '${ fullPath(key) }': expecting value of type array, got '${ JSON.stringify(profileVal) }'`);
        } else {
          errors.push(`Error for field '${ fullPath(key) }': expecting value of type ${ typeof schemaVal }, got an array ${ JSON.stringify(profileVal) }`);
        }
      }
    } else if (typeof profileVal !== 'object') {
      if (typeof profileVal !== typeof schemaVal) {
        errors.push(`Error for field '${ fullPath(key) }': expecting value of type ${ typeof schemaVal }, got '${ JSON.stringify(profileVal) }'`);
      }
    } else if (haveUserDefinedObject(parentPathParts.concat(key))) {
      // Keep this part of the profile
    } else if (typeof profileVal !== typeof schemaVal) {
      errors.push(`Error for field '${ fullPath(key) }': expecting value of type ${ typeof schemaVal }, got '${ JSON.stringify(profileVal) }'`);
    } else {
      // Finally recurse and compare the schema sub-object with the specified sub-object
      validateDeploymentProfileWithErrors(profileVal, errors, schemaVal, [...parentPathParts, key]);
    }
  }

  return profile;
}

const caseInsensitiveComparator = new Intl.Collator('en', { sensitivity: 'base' });

function isEquivalentIgnoreCase(a: string, b: string): boolean {
  return caseInsensitiveComparator.compare(a, b) === 0;
}

function fixProfileKeyCase(key: string, schemaKeys: string[]): string | null {
  return schemaKeys.find(val => isEquivalentIgnoreCase(key, val)) ?? null;
}

const userDefinedKeys = [
  'application.extensions.installed',
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
 *                    On other platforms it is the path-parts up to but not including the root (which is unnamed anyway).
 * @returns boolean
 */
function haveUserDefinedObject(pathParts: string[]): boolean {
  return userDefinedKeys.some(userDefinedKey => _.isEqual(userDefinedKey, pathParts));
}
