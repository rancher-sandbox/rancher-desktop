import os from 'os';

import _ from 'lodash';

import { defaultSettings, Settings } from '@/config/settings';
import { NavItemName, navItemNames, TransientSettings } from '@/config/transientSettings';
import { PathManagementStrategy } from '@/integrations/pathManager';
import { RecursivePartial } from '@/utils/typeUtils';
import { preferencesNavItems } from '@/window/preferences';

type settingsLike = Record<string, any>;

/**
 * ValidatorFunc describes a validation function; it is used to check if a
 * given proposed setting is compatible.
 * @param currentValue The value of the setting, before changing.
 * @param desiredValue The new value that the user is setting.
 * @param errors An array that any validation errors should be appended to.
 * @param fqname The fully qualified name of the setting, for formatting in error messages.
 * @returns Whether the setting has changed.
 */
type ValidatorFunc<C, D> =
  (currentValue: C, desiredValue: D, errors: string[], fqname: string) => boolean;

/**
 * SettingsValidationMapEntry describes validators that are valid for some
 * subtree of the full settings object.  The value must be either a ValidatorFunc
 * for that subtree, or an object containing validators for each member of the
 * subtree.
 */
type SettingsValidationMapEntry<T> = {
  [k in keyof T]:
  T[k] extends string | Array<string> | number | boolean ?
  ValidatorFunc<T[k], T[k]> :
  T[k] extends Record<string, infer V> ?
  SettingsValidationMapEntry<T[k]> | ValidatorFunc<T[k], Record<string, V>> :
  never;
};

/**
 * SettingsValidationMap describes the full set of validators that will be used
 * for all settings.
 */
type SettingsValidationMap = SettingsValidationMapEntry<Settings>;

type TransientSettingsValidationMap = SettingsValidationMapEntry<TransientSettings>;

export default class SettingsValidator {
  k8sVersions: Array<string> = [];
  allowedSettings: SettingsValidationMap | null = null;
  allowedTransientSettings: TransientSettingsValidationMap | null = null;
  synonymsTable: settingsLike|null = null;
  isKubernetesDesired = false;

  validateSettings(currentSettings: Settings, newSettings: RecursivePartial<Settings>): [boolean, string[]] {
    this.isKubernetesDesired = typeof newSettings.kubernetes?.enabled !== 'undefined' ? newSettings.kubernetes.enabled : currentSettings.kubernetes.enabled;
    this.allowedSettings ||= {
      version:         this.checkUnchanged,
      containerEngine: {
        imageAllowList:             {
          // TODO (maybe): `patterns` and `enabled` should be immutable if `locked` is true
          enabled:  this.checkBoolean,
          locked:   this.checkUnchanged,
          patterns: this.checkStringArray,
        },
      },
      kubernetes: {
        version:                    this.checkKubernetesVersion,
        memoryInGB:                 this.checkLima(this.checkNumber(0, Number.POSITIVE_INFINITY)),
        numberCPUs:                 this.checkLima(this.checkNumber(0, Number.POSITIVE_INFINITY)),
        port:                       this.checkNumber(1, 65535),
        containerEngine:            this.checkContainerEngine,
        checkForExistingKimBuilder: this.checkUnchanged, // Should only be set internally
        enabled:                    this.checkBoolean,
        WSLIntegrations:            this.checkPlatform('win32', this.checkBooleanMapping),
        options:                    { traefik: this.checkBoolean, flannel: this.checkBoolean },
        suppressSudo:               this.checkLima(this.checkBoolean),
        hostResolver:               this.checkPlatform('win32', this.checkBoolean),
        experimental:               { socketVMNet: this.checkPlatform('darwin', this.checkBoolean) },
      },
      portForwarding: { includeKubernetesServices: this.checkBoolean },
      images:         {
        showAll:   this.checkBoolean,
        namespace: this.checkString,
      },
      telemetry:              this.checkBoolean,
      updater:                this.checkBoolean,
      debug:                  this.checkBoolean,
      pathManagementStrategy: this.checkLima(this.checkPathManagementStrategy),
      diagnostics:            {
        mutedChecks: this.checkBooleanMapping,
        showMuted:   this.checkBoolean,
      },
    };
    this.canonicalizeSynonyms(newSettings);
    const errors: Array<string> = [];
    const needToUpdate = this.checkProposedSettings(this.allowedSettings, currentSettings, newSettings, errors, '');

    return [needToUpdate && errors.length === 0, errors];
  }

  validateTransientSettings(
    currentTransientSettings: TransientSettings,
    newTransientSettings: RecursivePartial<TransientSettings>,
  ): [boolean, string[]] {
    this.allowedTransientSettings ||= {
      noModalDialogs: this.checkBoolean,
      preferences:    {
        navItem: {
          current:     this.checkPreferencesNavItemCurrent,
          currentTabs: this.checkPreferencesNavItemCurrentTabs,
        },
      },
    };

    this.canonicalizeSynonyms(currentTransientSettings);
    const errors: Array<string> = [];
    const needToUpdate = this.checkProposedSettings(
      this.allowedTransientSettings,
      currentTransientSettings,
      newTransientSettings,
      errors,
      '',
    );

    return [needToUpdate && errors.length === 0, errors];
  }

  /**
   * The core function for checking proposed user settings.
   * Walks the input: the user-provided object holding the new (and existing settings) against a verifier:
   * 1. Complains about any fields in the input that aren't in the verifier
   * 2. Recursively walks child-objects in the input and verifier
   * 3. Calls validation functions off the verifier
   * @param allowedSettings - The verifier
   * @param currentSettings - The current preferences object
   * @param newSettings - User's proposed new settings
   * @param errors - Builds this list up as new errors are encountered, so multiple errors can be reported.
   * @param prefix - For error messages only, e.g. '' for root, 'kubernetes.options', etc.
   * @returns boolean - true if there are changes that need to be applied.
   */
  protected checkProposedSettings(
    allowedSettings: settingsLike,
    currentSettings: settingsLike,
    newSettings: settingsLike,
    errors: string[],
    prefix: string): boolean {
    // Note the "busy-evaluation" form below is used to call functions for the side-effect of error-detection:
    // changeNeeded = f(...) || changeNeeded
    let changeNeeded = false;

    for (const k in newSettings) {
      const fqname = prefix ? `${ prefix }.${ k }` : k;

      if (!(k in allowedSettings)) {
        continue;
      } else if (typeof (allowedSettings[k]) === 'object') {
        if (typeof (newSettings[k]) === 'object') {
          changeNeeded = this.checkProposedSettings(allowedSettings[k], currentSettings[k], newSettings[k], errors, fqname) || changeNeeded;
        } else {
          errors.push(`Setting ${ fqname } should wrap an inner object, but got <${ newSettings[k] }>.`);
        }
      } else if (typeof (newSettings[k]) === 'object') {
        if (typeof allowedSettings[k] === 'function') {
          // Special case for things like `.WSLIntegrations` which have unknown fields.
          changeNeeded = allowedSettings[k].call(this, currentSettings[k], newSettings[k], errors, fqname) || changeNeeded;
        } else {
          // newSettings[k] should be valid JSON because it came from `JSON.parse(incoming-payload)`.
          // It's an internal error (HTTP Status 500) if it isn't.
          errors.push(`Setting ${ fqname } should be a simple value, but got <${ JSON.stringify(newSettings[k]) }>.`);
        }
      } else if (typeof allowedSettings[k] === 'function') {
        changeNeeded = allowedSettings[k].call(this, currentSettings[k], newSettings[k], errors, fqname) || changeNeeded;
      } else {
        errors.push(this.notSupported(fqname));
      }
    }

    return changeNeeded;
  }

  protected invalidSettingMessage(fqname: string, desiredValue: any): string {
    return `Invalid value for ${ fqname }: <${ JSON.stringify(desiredValue) }>`;
  }

  /**
   * checkLima ensures that the given parameter is only set on Lima-based platforms.
   * @note This should not be used for things with default values.
   */
  protected checkLima<C, D>(validator: ValidatorFunc<C, D>) {
    return (currentValue: C, desiredValue: D, errors: string[], fqname: string) => {
      if (!_.isEqual(currentValue, desiredValue)) {
        if (!['darwin', 'linux'].includes(os.platform())) {
          errors.push(this.notSupported(fqname));

          return false;
        }
      }

      return validator.call(this, currentValue, desiredValue, errors, fqname);
    };
  }

  protected checkPlatform<C, D>(platform: NodeJS.Platform, validator: ValidatorFunc<C, D>) {
    return (currentValue: C, desiredValue: D, errors: string[], fqname: string) => {
      if (!_.isEqual(currentValue, desiredValue)) {
        if (os.platform() !== platform) {
          errors.push(this.notSupported(fqname));

          return false;
        }
      }

      return validator.call(this, currentValue, desiredValue, errors, fqname);
    };
  }

  /**
   * checkBoolean is a generic checker for simple boolean values.
   */
  protected checkBoolean(currentValue: boolean, desiredValue: boolean, errors: string[], fqname: string): boolean {
    if (typeof desiredValue !== 'boolean') {
      errors.push(this.invalidSettingMessage(fqname, desiredValue));

      return false;
    }

    return currentValue !== desiredValue;
  }

  /**
   * checkNumber returns a checker for a number in the given range, inclusive.
   */
  protected checkNumber(min: number, max: number) {
    return (currentValue: number, desiredValue: number, errors: string[], fqname: string) => {
      if (typeof desiredValue !== 'number') {
        errors.push(this.invalidSettingMessage(fqname, desiredValue));

        return false;
      }
      if (desiredValue < min || desiredValue > max) {
        errors.push(this.invalidSettingMessage(fqname, desiredValue));

        return false;
      }

      return currentValue !== desiredValue;
    };
  }

  protected checkString(currentValue: string, desiredValue: string, errors: string[], fqname: string): boolean {
    if (typeof desiredValue !== 'string') {
      errors.push(this.invalidSettingMessage(fqname, desiredValue));

      return false;
    }

    return currentValue !== desiredValue;
  }

  protected checkContainerEngine(currentValue: string, desiredEngine: string, errors: string[], fqname: string): boolean {
    if (!['containerd', 'moby'].includes(desiredEngine)) {
      // The error message says 'docker' is ok, although it should have been converted to 'moby' by now.
      // But the word "'docker'" is valid in a raw API call.
      errors.push(`Invalid value for ${ fqname }: <${ JSON.stringify(desiredEngine) }>; must be 'containerd', 'docker', or 'moby'`);

      return false;
    }

    return currentValue !== desiredEngine;
  }

  protected checkKubernetesVersion(currentValue: string, desiredVersion: string, errors: string[], _: string): boolean {
    /**
     * desiredVersion can be an empty string when Kubernetes is disabled, but otherwise it must be a valid version.
    */
    if ((this.isKubernetesDesired || desiredVersion !== '') && !this.k8sVersions.includes(desiredVersion)) {
      errors.push(`Kubernetes version "${ desiredVersion }" not found.`);

      return false;
    }

    return currentValue !== desiredVersion;
  }

  protected notSupported(fqname: string) {
    return `Changing field ${ fqname } via the API isn't supported.`;
  }

  protected checkUnchanged(currentValue: any, desiredValue: any, errors: string[], fqname: string): boolean {
    if (currentValue !== desiredValue) {
      errors.push(this.notSupported(fqname));
    }

    return false;
  }

  /**
   * Ensures settings that are objects adhere to their type of
   * Record<string, boolean>. This is useful for checking that values other than
   * booleans are not unintentionally added to settings like WSLIntegrations
   * and mutedChecks.
   */
  protected checkBooleanMapping(currentValue: Record<string, boolean>, desiredValue: Record<string, boolean>, errors: string[], fqname: string): boolean {
    if (typeof (desiredValue) !== 'object') {
      errors.push(`Proposed field ${ fqname } should be an object, got <${ desiredValue }>.`);

      return false;
    }

    let changed = false;

    for (const [key, value] of Object.entries(desiredValue)) {
      if (typeof value !== 'boolean') {
        errors.push(this.invalidSettingMessage(`${ fqname }.${ key }`, desiredValue[key]));
      } else {
        changed ||= currentValue[key] !== value;
      }
    }

    return errors.length === 0 && changed;
  }

  protected checkStringArray(currentValue: string[], desiredValue: string[], errors: string[], fqname: string): boolean {
    if (!Array.isArray(desiredValue) || desiredValue.some(s => typeof (s) !== 'string')) {
      errors.push(this.invalidSettingMessage(fqname, desiredValue));

      return false;
    }

    return currentValue.length !== desiredValue.length || currentValue.some((v, i) => v !== desiredValue[i]);
  }

  protected checkPathManagementStrategy(currentValue: PathManagementStrategy,
    desiredValue: any, errors: string[], fqname: string): boolean {
    if (!(Object.values(PathManagementStrategy).includes(desiredValue))) {
      errors.push(`${ fqname }: "${ desiredValue }" is not a valid strategy`);

      return false;
    }

    if (desiredValue !== currentValue) {
      if (desiredValue === PathManagementStrategy.NotSet) {
        errors.push(`${ fqname }: "${ desiredValue }" is not a valid strategy`);

        return false;
      }

      return true;
    }

    return false;
  }

  protected checkPreferencesNavItemCurrent(
    currentValue: NavItemName,
    desiredValue: NavItemName,
    errors: string[],
    fqname: string,
  ): boolean {
    if (!desiredValue || !navItemNames.includes(desiredValue)) {
      errors.push(`${ fqname }: "${ desiredValue }" is not a valid page name for Preferences Dialog`);

      return false;
    }

    return currentValue !== desiredValue;
  }

  protected checkPreferencesNavItemCurrentTabs(
    currentValue: Record<NavItemName, string | undefined>,
    desiredValue: any,
    errors: string[],
    fqname: string,
  ): boolean {
    for (const k of Object.keys(desiredValue)) {
      if (!navItemNames.includes(k as NavItemName)) {
        errors.push(`${ fqname }: "${ k }" is not a valid page name for Preferences Dialog`);

        return false;
      }

      const navItem = preferencesNavItems.find(item => item.name === k);

      if (!navItem?.tabs?.includes(desiredValue[k])) {
        errors.push(`${ fqname }: tab name "${ desiredValue[k] }" is not a valid tab name for "${ k }" Preference page`);

        return false;
      }
    }

    return !_.isEqual(currentValue, desiredValue);
  }

  canonicalizeSynonyms(newSettings: settingsLike): void {
    this.synonymsTable ||= {
      kubernetes: {
        version:         this.canonicalizeKubernetesVersion,
        containerEngine: this.canonicalizeContainerEngine,
      },
    };
    this.canonicalizeSettings(this.synonymsTable, newSettings, []);
  }

  protected canonicalizeSettings(synonymsTable: settingsLike, newSettings: settingsLike, prefix: string[]): void {
    for (const k in newSettings) {
      if (typeof newSettings[k] === 'object') {
        this.canonicalizeSettings(synonymsTable[k] ?? {}, newSettings[k], prefix.concat(k));
      } else if (typeof synonymsTable[k] === 'function') {
        synonymsTable[k].call(this, newSettings, k);
      } else if (typeof _.get(defaultSettings, prefix.concat(k)) === 'boolean') {
        this.canonicalizeBool(newSettings, k);
      } else if (typeof _.get(defaultSettings, prefix.concat(k)) === 'number') {
        this.canonicalizeNumber(newSettings, k);
      }
    }
  }

  protected canonicalizeKubernetesVersion(newSettings: settingsLike, index: string): void {
    const desiredValue: string = newSettings[index];
    const ptn = /^(v?)(\d+\.\d+\.\d+)((?:\+k3s\d+)?)$/;
    const m = ptn.exec(desiredValue);

    if (m && (m[1] || m[3])) {
      newSettings[index] = m[2];
    }
  }

  protected canonicalizeContainerEngine(newSettings: settingsLike, index: string): void {
    if (newSettings[index] === 'docker') {
      newSettings[index] = 'moby';
    }
  }

  protected canonicalizeBool(newSettings: settingsLike, index: string): void {
    const desiredValue: boolean|string = newSettings[index];

    if (desiredValue === 'true') {
      newSettings[index] = true;
    } else if (desiredValue === 'false') {
      newSettings[index] = false;
    }
  }

  protected canonicalizeNumber(newSettings: settingsLike, index: string): void {
    const desiredValue: number | string = newSettings[index];

    if (typeof desiredValue === 'string') {
      const parsedValue = parseInt(desiredValue, 10);

      // Ignore NaN; we'll fail validation later.
      if (!Number.isNaN(parsedValue)) {
        newSettings[index] = parsedValue;
      }
    }
  }
}
