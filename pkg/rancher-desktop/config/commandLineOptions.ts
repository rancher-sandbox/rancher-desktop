import { join } from 'path';

import _ from 'lodash';

import { LockedSettingsType, Settings } from '@pkg/config/settings';
import { save, turnFirstRunOff } from '@pkg/config/settingsImpl';
import { TransientSettings } from '@pkg/config/transientSettings';
import SettingsValidator from '@pkg/main/commandServer/settingsValidator';
import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';
import { RecursiveKeys, RecursivePartial } from '@pkg/utils/typeUtils';

const console = Logging.settings;

export class LockedFieldError extends Error {}

export class FatalCommandLineOptionError extends Error {}

/**
 * Takes an array of strings, presumably from a command-line used to launch the app.
 * Key operations:
 * * All options start with '--'.
 * * Ignore leading unrecognized options.
 * * Complain about any unrecognized options after a recognized option has been processed.
 * * This calls the same settings-validator as used by `rdctl set` and the API to catch
 *   any attempts to update a locked field.
 *
 *  * All errors are fatal as this function is like an API for launching the application.
 * @param cfg - current loaded settings - this is updated and also returned
 * @param lockedFields - current locked fields
 * @param commandLineArgs - new command-line args to be merged into `cfg` (error if the field is locked)
 * @return updated cfg
 */
export function updateFromCommandLine(cfg: Settings, lockedFields: LockedSettingsType, commandLineArgs: string[]): Settings {
  const lim = commandLineArgs.length;

  if (lim === 0) {
    return cfg;
  }
  let processingExternalArguments = true;
  let newSettings: RecursivePartial<Settings> = {};

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
    const currentValue: boolean | string | number | Record<string, undefined> | undefined = _.get(cfg, fqFieldName);

    if (currentValue === undefined) {
      // Ignore unrecognized command-line options until we get to one we recognize
      if (processingExternalArguments) {
        console.warn(`Unrecognized command-line argument ${ arg }`);
        continue;
      }
      throw new Error(`Can't evaluate command-line argument ${ arg } -- no such entry in current settings at ${ join(paths.config, 'settings.json') }`);
    }

    processingExternalArguments = false;
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
      } catch (cause) {
        throw new Error(`Can't evaluate --${ fqFieldName }=${ finalValue } as ${ currentValueType }: ${ cause }`, { cause });
      }
      // We know the current value's type is either boolean or number, so a constrained comparison is ok
      // eslint-disable-next-line valid-typeof
      if (typeof finalValue !== currentValueType) {
        throw new TypeError(`Type of '${ finalValue }' is ${ typeof finalValue }, but current type of ${ fqFieldName } is ${ currentValueType } `);
      }
    }
    newSettings = _.merge(newSettings, getObjectRepresentation(fqFieldName as RecursiveKeys<Settings>, finalValue));
  }
  const settingsValidator = new SettingsValidator();
  const newKubernetesVersion = newSettings.kubernetes?.version;

  if (newKubernetesVersion) {
    // RD hasn't loaded the supported k8s versions yet, so fake the list.
    // If the field is locked, we don't need to know what it's locked to,
    // just that the proposed version is different from the current version.
    // The current version doesn't have to be the locked version, but will be after processing ends.
    const limitedK8sVersionList: string[] = [newKubernetesVersion];

    if (cfg.kubernetes.version) {
      limitedK8sVersionList.push(cfg.kubernetes.version);
    }
    settingsValidator.k8sVersions = limitedK8sVersionList;
  }
  const [needToUpdate, errors, isFatal] = settingsValidator.validateSettings(cfg, newSettings, lockedFields);

  if (errors.length > 0) {
    const errorString = `Error in command-line options:\n${ errors.join('\n') }`;

    if (errors.some(error => /field ".+?" is locked/.test(error))) {
      throw new LockedFieldError(errorString);
    }
    if (isFatal) {
      throw new FatalCommandLineOptionError(errorString);
    }
    throw new Error(errorString);
  }
  if (needToUpdate) {
    cfg = _.merge(cfg, newSettings);
    save(cfg);
  } else {
    console.debug(`No need to update preferences based on command-line options ${ commandLineArgs.join(', ') }`);
  }
  turnFirstRunOff();

  return cfg;
}

// This is similar to `lodash.set({}, fqFieldAccessor, finalValue)
// but it also does some error checking.
// On the happy path, it's exactly like `lodash.set`
// exported for unit tests only
export function getObjectRepresentation(fqFieldAccessor: RecursiveKeys<Settings>, finalValue: boolean | number | string): RecursivePartial<Settings> {
  if (!fqFieldAccessor) {
    throw new Error("Invalid command-line option: can't be the empty string.");
  }
  const optionParts: string[] = fqFieldAccessor.split('.');

  if (optionParts.length === 1) {
    return { [fqFieldAccessor]: finalValue };
  }
  const lastField: string | undefined = optionParts.pop();

  if (!lastField) {
    throw new Error("Unrecognized command-line option ends with a dot ('.')");
  }

  return _.set({}, fqFieldAccessor, finalValue) as RecursivePartial<Settings>;
}
