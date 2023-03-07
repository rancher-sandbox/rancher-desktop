import { join } from 'path';

import _ from 'lodash';

import { LockedSettingsType, save, Settings, turnFirstRunOff } from '@pkg/config/settings';
import { TransientSettings } from '@pkg/config/transientSettings';
import SettingsValidator from '@pkg/main/commandServer/settingsValidator';
import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';
import { RecursiveKeys, RecursivePartial } from '@pkg/utils/typeUtils';

const console = Logging.settings;

export class LockedFieldError extends Error {}

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
 * @param cfg
 * @param lockedFields
 * @param commandLineArgs
 * @return updated cfg
 */
export function updateFromCommandLine(cfg: Settings, lockedFields: LockedSettingsType, commandLineArgs: string[]): Settings {
  const lim = commandLineArgs.length;
  let processingExternalArguments = true;
  const updatedCfg = _.merge({}, cfg);
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
    const lhsInfo = getUpdatableNode(updatedCfg, fqFieldName);

    if (!lhsInfo) {
      if (processingExternalArguments) {
        continue;
      }
      throw new Error(`Can't evaluate command-line argument ${ arg } -- no such entry in current settings at ${ join(paths.config, 'settings.json') }`);
    }
    processingExternalArguments = false;
    const [lhs, finalFieldName] = lhsInfo;
    const currentValue: 'boolean'|'string'|'number'|'object' = lhs[finalFieldName];
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
    newSettings = _.merge(newSettings, getObjectRepresentation(fqFieldName as RecursiveKeys<Settings>, finalValue));
  }
  if (lim > 0) {
    const deferredSettings: RecursivePartial<Settings> = {};

    if (newSettings.kubernetes?.version) {
      // This has to be deferred because the system hasn't loaded the known k8s versions yet
      // Don't verify the version, and if it's invalid, the system will pick the closest match.
      deferredSettings.kubernetes = { version: newSettings.kubernetes.version };
      delete newSettings.kubernetes.version;
    }
    const [needToUpdate, errors] = (new SettingsValidator()).validateSettings(cfg, newSettings, lockedFields);

    if (errors.length > 0) {
      const errorString = `Error in command-line options:\n${ errors.join('\n') }`;

      if (errors.find(error => /field '.+?' is locked/.test(error))) {
        throw new LockedFieldError(errorString);
      }
      throw new Error(errorString);
    }
    if (needToUpdate || deferredSettings.kubernetes) {
      if (deferredSettings.kubernetes) {
        newSettings.kubernetes ??= {}; // for typescript
        newSettings.kubernetes.version = deferredSettings.kubernetes.version;
      }
      cfg = _.merge(cfg, newSettings);
      save(cfg);
    } else {
      console.log(`No need to update preferences based on command-line options ${ commandLineArgs.join(', ') }`);
    }
    turnFirstRunOff();
  }

  return cfg;
}

// This is similar to `lodash.set({}, fqFieldAccessor, finalValue)
// but it also does some error checking.
// On the happy path, it's exactly like `lodash.set`
// exported for unit tests only
export function getObjectRepresentation(fqFieldAccessor: RecursiveKeys<Settings>, finalValue: boolean|number|string): RecursivePartial<Settings> {
  if (!fqFieldAccessor) {
    throw new Error("Invalid command-line option: can't be the empty string.");
  }
  const optionParts: string[] = fqFieldAccessor.split('.');

  if (optionParts.length === 1) {
    return { [fqFieldAccessor]: finalValue };
  }
  const lastField: string|undefined = optionParts.pop();

  if (!lastField) {
    throw new Error("Unrecognized command-line option ends with a dot ('.')");
  }

  return _.set({}, fqFieldAccessor, finalValue) as RecursivePartial<Settings>;
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
 * @param fqFieldAccessor: a multi-component dotted name representing a path to a node in the settings object.
 * @returns [internal node in cfg, final accessor name], or
 *          `null` if fqFieldAccessor doesn't point to a node in the settings tree.
 */
export function getUpdatableNode(cfg: Settings, fqFieldAccessor: string): [Record<string, any>, string] | null {
  // Given an accessor like a.b.c.d:
  // If `a.b.c` is found in cfg, return `[cfg[a][b][c], d]`.
  // Otherwise return null.
  // Need a special case where the accessor has no dots (i.e. is top-level).
  const optionParts = fqFieldAccessor.split('.');
  const finalOptionPart = optionParts.pop() ?? '';
  const currentConfig = optionParts.length === 0 ? cfg : _.get(cfg, optionParts.join('.'));

  return (finalOptionPart in (currentConfig || {})) ? [currentConfig, finalOptionPart] : null;
}
