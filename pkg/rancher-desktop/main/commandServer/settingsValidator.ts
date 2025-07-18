import os from 'os';

import _ from 'lodash';
import semver from 'semver';

import {
  CacheMode,
  defaultSettings,
  LockedSettingsType,
  MountType,
  ProtocolVersion,
  SecurityModel,
  Settings,
  VMType,
} from '@pkg/config/settings';
import { NavItemName, navItemNames, TransientSettings } from '@pkg/config/transientSettings';
import { PathManagementStrategy } from '@pkg/integrations/pathManager';
import { parseImageReference, validateImageName, validateImageTag } from '@pkg/utils/dockerUtils';
import { getMacOsVersion } from '@pkg/utils/osVersion';
import { RecursivePartial } from '@pkg/utils/typeUtils';
import { preferencesNavItems } from '@pkg/window/preferenceConstants';

type settingsLike = Record<string, any>;

/**
 * ValidatorFunc describes a validation function; it is used to check if a
 * given proposed setting is compatible.
 * @param mergedSettings The root of the merged settings object.
 * @param currentValue The value of the setting, before changing.
 * @param desiredValue The new value that the user is setting.
 * @param errors An array that any validation errors should be appended to.
 * @param fqname The fully qualified name of the setting, for formatting in error messages.
 * @returns boolean - true if the setting has been changed otherwise false.
 */
type ValidatorFunc<S, C, D> =
  (mergedSettings: S, currentValue: C, desiredValue: D, errors: string[], fqname: string) => boolean;

/**
 * SettingsValidationMapEntry describes validators that are valid for some
 * subtree of the full settings object.  The value must be either a ValidatorFunc
 * for that subtree, or an object containing validators for each member of the
 * subtree.
 */
type SettingsValidationMapEntry<S, T> = {
  [k in keyof T]:
  T[k] extends string | string[] | number | boolean ?
    ValidatorFunc<S, T[k], T[k]> :
    T[k] extends Record<string, infer V> ?
  SettingsValidationMapEntry<S, T[k]> | ValidatorFunc<S, T[k], Record<string, V>> :
      never;
};

/**
 * SettingsValidationMap describes the full set of validators that will be used
 * for all settings.
 */
type SettingsValidationMap = SettingsValidationMapEntry<Settings, Settings>;

type TransientSettingsValidationMap = SettingsValidationMapEntry<TransientSettings, TransientSettings>;

export default class SettingsValidator {
  k8sVersions:              string[] = [];
  allowedSettings:          SettingsValidationMap | null = null;
  allowedTransientSettings: TransientSettingsValidationMap | null = null;
  synonymsTable:            settingsLike | null = null;
  lockedSettings:           LockedSettingsType = { };
  protected isFatal = false;

  validateSettings(
    currentSettings: Settings,
    newSettings: RecursivePartial<Settings>,
    lockedSettings: LockedSettingsType = {},
  ): [boolean, string[], boolean] {
    this.lockedSettings = lockedSettings;
    this.isFatal = false;
    this.allowedSettings ||= {
      version:     this.checkUnchanged,
      application: {
        adminAccess: this.checkLima(this.checkBoolean),
        debug:       this.checkBoolean,
        extensions:  {
          allowed: {
            enabled: this.checkBoolean,
            list:    this.checkExtensionAllowList,
          },
          installed: this.checkInstalledExtensions,
        },
        pathManagementStrategy: this.checkLima(this.checkEnum(...Object.values(PathManagementStrategy))),
        telemetry:              { enabled: this.checkBoolean },
        /** Whether we should check for updates and apply them. */
        updater:                { enabled: this.checkBoolean },
        autoStart:              this.checkBoolean,
        startInBackground:      this.checkBoolean,
        hideNotificationIcon:   this.checkBoolean,
        window:                 { quitOnClose: this.checkBoolean },
      },
      containerEngine: {
        allowedImages: {
          enabled:  this.checkBoolean,
          patterns: this.checkUniqueStringArray,
        },
        // 'docker' has been canonicalized to 'moby' already, but we want to include it as a valid value in the error message
        name: this.checkEnum('containerd', 'moby', 'docker'),
      },
      virtualMachine: {
        memoryInGB: this.checkLima(this.checkNumber(1, Number.POSITIVE_INFINITY)),
        numberCPUs: this.checkLima(this.checkNumber(1, Number.POSITIVE_INFINITY)),
        useRosetta: this.checkPlatform('darwin', this.checkRosetta),
        type:       this.checkPlatform('darwin', this.checkMulti(
          this.checkEnum(...Object.values(VMType)),
          this.checkVMType),
        ),
        mount: {
          type: this.checkLima(this.checkMulti(
            this.checkEnum(...Object.values(MountType)),
            this.checkMountType),
          ),
        },
      },
      experimental: {
        containerEngine: { webAssembly: { enabled: this.checkBoolean } },
        kubernetes:      { options: { spinkube: this.checkMulti(this.checkBoolean, this.checkSpinkube) } },
        virtualMachine:  {
          mount: {
            '9p': {
              securityModel:   this.checkLima(this.check9P(this.checkEnum(...Object.values(SecurityModel)))),
              protocolVersion: this.checkLima(this.check9P(this.checkEnum(...Object.values(ProtocolVersion)))),
              msizeInKib:      this.checkLima(this.check9P(this.checkNumber(4, Number.POSITIVE_INFINITY))),
              cacheMode:       this.checkLima(this.check9P(this.checkEnum(...Object.values(CacheMode)))),
            },
          },
          proxy: {
            enabled:  this.checkPlatform('win32', this.checkBoolean),
            address:  this.checkPlatform('win32', this.checkString),
            password: this.checkPlatform('win32', this.checkString),
            port:     this.checkPlatform('win32', this.checkNumber(1, 65535)),
            username: this.checkPlatform('win32', this.checkString),
            noproxy:  this.checkPlatform('win32', this.checkUniqueStringArray),
          },
          sshPortForwarder: this.checkLima(this.checkBoolean),
        },
      },
      WSL:        { integrations: this.checkPlatform('win32', this.checkBooleanMapping) },
      kubernetes: {
        version: this.checkKubernetesVersion,
        port:    this.checkNumber(1, 65535),
        enabled: this.checkBoolean,
        options: { traefik: this.checkBoolean, flannel: this.checkBoolean },
        ingress: { localhostOnly: this.checkPlatform('win32', this.checkBoolean) },
      },
      portForwarding: { includeKubernetesServices: this.checkBoolean },
      images:         {
        showAll:   this.checkBoolean,
        namespace: this.checkString,
      },
      containers: {
        showAll:   this.checkBoolean,
        namespace: this.checkString,
      },
      diagnostics: {
        mutedChecks: this.checkBooleanMapping,
        showMuted:   this.checkBoolean,
      },
    };
    this.canonicalizeSynonyms(newSettings);
    const errors: string[] = [];
    const needToUpdate = this.checkProposedSettings(
      _.merge({}, currentSettings, newSettings),
      this.allowedSettings,
      currentSettings,
      newSettings,
      errors,
      '',
    );

    return [needToUpdate && errors.length === 0, errors, this.isFatal];
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
    const errors: string[] = [];
    const needToUpdate = this.checkProposedSettings(
      _.merge({}, currentTransientSettings, newTransientSettings),
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
   * @param mergedSettings - The root object of the merged current and new settings
   * @param allowedSettings - The verifier
   * @param currentSettings - The current preferences object
   * @param newSettings - User's proposed new settings
   * @param errors - Builds this list up as new errors are encountered, so multiple errors can be reported.
   * @param prefix - For error messages only, e.g. '' for root, 'kubernetes.options', etc.
   * @returns boolean - true if there are changes that need to be applied.
   */
  protected checkProposedSettings<S>(
    mergedSettings: S,
    allowedSettings: settingsLike,
    currentSettings: settingsLike,
    newSettings: settingsLike,
    errors: string[],
    prefix: string): boolean {
    let changeNeeded = false; // can only be set to true once we have a change to make, never back to false

    for (const k in newSettings) {
      let changeNeededHere = false;
      const fqname = prefix ? `${ prefix }.${ k }` : k;

      if (!(k in allowedSettings)) {
        continue;
      }
      if (typeof (allowedSettings[k]) === 'object') {
        if (typeof (newSettings[k]) === 'object') {
          changeNeeded = this.checkProposedSettings(mergedSettings, allowedSettings[k], currentSettings[k], newSettings[k], errors, fqname) || changeNeeded;
        } else {
          errors.push(`Setting "${ fqname }" should wrap an inner object, but got <${ newSettings[k] }>.`);
        }
      } else if (typeof (newSettings[k]) === 'object') {
        if (typeof allowedSettings[k] === 'function') {
          // Special case for things like `.WSLIntegrations` which have unknown fields.
          const validator: ValidatorFunc<S, any, any> = allowedSettings[k];

          changeNeededHere = validator.call(this, mergedSettings, currentSettings[k], newSettings[k], errors, fqname);
        } else {
          // newSettings[k] should be valid JSON because it came from `JSON.parse(incoming-payload)`.
          // It's an internal error (HTTP Status 500) if it isn't.
          errors.push(`Setting "${ fqname }" should be a simple value, but got <${ JSON.stringify(newSettings[k]) }>.`);
        }
      } else if (typeof allowedSettings[k] === 'function') {
        const validator: ValidatorFunc<S, any, any> = allowedSettings[k];

        changeNeededHere = validator.call(this, mergedSettings, currentSettings[k], newSettings[k], errors, fqname);
      } else {
        errors.push(this.notSupported(fqname));
      }
      if (changeNeededHere) {
        const isLocked = _.get(this.lockedSettings, `${ prefix }.${ k }`);

        if (isLocked) {
          // A delayed error condition, raised only if we try to change a field in a locked object
          errors.push(`field "${ prefix }.${ k }" is locked`);
          this.isFatal = true;
        } else {
          changeNeeded = true;
        }
      }
    }

    return changeNeeded;
  }

  protected invalidSettingMessage(fqname: string, desiredValue: any): string {
    return `Invalid value for "${ fqname }": <${ JSON.stringify(desiredValue) }>`;
  }

  /**
   * checkLima ensures that the given parameter is only set on Lima-based platforms.
   * @note This should not be used for things with default values.
   */
  protected checkLima<C, D>(validator: ValidatorFunc<Settings, C, D>) {
    return (mergedSettings: Settings, currentValue: C, desiredValue: D, errors: string[], fqname: string) => {
      if (!['darwin', 'linux'].includes(os.platform())) {
        if (!_.isEqual(currentValue, desiredValue)) {
          this.isFatal = true;
          errors.push(this.notSupported(fqname));
        }

        return false;
      }

      return validator.call(this, mergedSettings, currentValue, desiredValue, errors, fqname);
    };
  }

  protected checkRosetta(mergedSettings: Settings, currentValue: boolean, desiredValue: boolean, errors: string[], fqname: string): boolean {
    if (desiredValue && !currentValue) {
      if (mergedSettings.virtualMachine.type !== VMType.VZ) {
        errors.push(`Setting ${ fqname } can only be enabled when virtual-machine.type is "${ VMType.VZ }".`);
        this.isFatal = true;

        return false;
      }
      if (process.arch !== 'arm64') {
        errors.push(`Setting ${ fqname } can only be enabled on aarch64 systems.`);
        this.isFatal = true;

        return false;
      }
    }

    return currentValue !== desiredValue;
  }

  protected checkVMType(mergedSettings: Settings, currentValue: string, desiredValue: string, errors: string[], fqname: string): boolean {
    if (desiredValue === VMType.VZ) {
      if (os.arch() === 'arm64' && semver.gt('13.3.0', getMacOsVersion())) {
        this.isFatal = true;
        errors.push(`Setting ${ fqname } to "${ VMType.VZ }" on ARM requires macOS 13.3 (Ventura) or later.`);

        return false;
      } else if (semver.gt('13.0.0', getMacOsVersion())) {
        this.isFatal = true;
        errors.push(`Setting ${ fqname } to "${ VMType.VZ }" on Intel requires macOS 13.0 (Ventura) or later.`);

        return false;
      }
      if (mergedSettings.virtualMachine.mount.type === MountType.NINEP) {
        errors.push(
          `Setting ${ fqname } to "${ VMType.VZ }" requires that virtual-machine.mount.type is ` +
          `"${ MountType.REVERSE_SSHFS }" or "${ MountType.VIRTIOFS }".`);

        return false;
      }
    }
    if (desiredValue === VMType.QEMU) {
      if (mergedSettings.virtualMachine.mount.type === MountType.VIRTIOFS && os.platform() === 'darwin') {
        errors.push(
          `Setting ${ fqname } to "${ VMType.QEMU }" requires that virtual-machine.mount.type is ` +
          `"${ MountType.REVERSE_SSHFS }" or "${ MountType.NINEP }".`);

        return false;
      }
    }

    return currentValue !== desiredValue;
  }

  protected checkMountType(mergedSettings: Settings, currentValue: string, desiredValue: string, errors: string[], fqname: string): boolean {
    if (desiredValue === MountType.VIRTIOFS && mergedSettings.virtualMachine.type !== VMType.VZ && os.platform() === 'darwin') {
      errors.push(`Setting ${ fqname } to "${ MountType.VIRTIOFS }" requires that virtual-machine.type is "${ VMType.VZ }".`);
      this.isFatal = true;

      return false;
    }
    if (desiredValue === MountType.VIRTIOFS && mergedSettings.virtualMachine.type !== VMType.QEMU && os.platform() === 'linux') {
      errors.push(`Setting ${ fqname } to "${ MountType.VIRTIOFS }" requires that virtual-machine.type is "${ VMType.QEMU }".`);
      this.isFatal = true;

      return false;
    }
    if (desiredValue === MountType.NINEP && mergedSettings.virtualMachine.type !== VMType.QEMU) {
      errors.push(`Setting ${ fqname } to "${ MountType.NINEP }" requires that virtual-machine.type is "${ VMType.QEMU }".`);
      this.isFatal = true;

      return false;
    }

    return currentValue !== desiredValue;
  }

  protected checkSpinkube(mergedSettings: Settings, currentValue: boolean, desiredValue: boolean, errors: string[], fqname: string): boolean {
    if (mergedSettings.kubernetes.enabled && desiredValue) {
      if (!mergedSettings.experimental.containerEngine.webAssembly.enabled) {
        errors.push(`Setting ${ fqname } can only be set when experimental.container-engine.web-assembly.enabled is set as well.`);
        this.isFatal = true;

        return false;
      }
    }

    return currentValue !== desiredValue;
  }

  protected checkPlatform<C, D>(platform: NodeJS.Platform, validator: ValidatorFunc<Settings, C, D>) {
    return (mergedSettings: Settings, currentValue: C, desiredValue: D, errors: string[], fqname: string) => {
      if (os.platform() !== platform) {
        if (!_.isEqual(currentValue, desiredValue)) {
          errors.push(this.notSupported(fqname));
          this.isFatal = true;
        }

        return false;
      }

      return validator.call(this, mergedSettings, currentValue, desiredValue, errors, fqname);
    };
  }

  protected check9P<C, D>(validator: ValidatorFunc<Settings, C, D>) {
    return (mergedSettings: Settings, currentValue: C, desiredValue: D, errors: string[], fqname: string) => {
      if (mergedSettings.virtualMachine.mount.type !== MountType.NINEP) {
        if (!_.isEqual(currentValue, desiredValue)) {
          errors.push(`Setting ${ fqname } can only be changed when virtualMachine.mount.type is "${ MountType.NINEP }".`);
          this.isFatal = true;
        }

        return false;
      }

      return validator.call(this, mergedSettings, currentValue, desiredValue, errors, fqname);
    };
  }

  protected checkMulti<S, C, D>(...validators: ValidatorFunc<S, C, D>[]) {
    return (mergedSettings: S, currentValue: C, desiredValue: D, errors: string[], fqname: string) => {
      let retval = false;

      for (const validator of validators) {
        retval = validator.call(this, mergedSettings, currentValue, desiredValue, errors, fqname) || retval;
      }

      return retval;
    };
  }

  /**
   * checkBoolean is a generic checker for simple boolean values.
   */
  protected checkBoolean<S>(mergedSettings: S, currentValue: boolean, desiredValue: boolean, errors: string[], fqname: string): boolean {
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
    return <S>(mergedSettings: S, currentValue: number, desiredValue: number, errors: string[], fqname: string) => {
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

  protected checkEnum(...validValues: string[]) {
    return <S>(mergedSettings: S, currentValue: string, desiredValue: string, errors: string[], fqname: string) => {
      const explanation = `must be one of ${ JSON.stringify(validValues) }`;

      if (typeof desiredValue !== 'string') {
        errors.push(`${ this.invalidSettingMessage(fqname, desiredValue) }; ${ explanation }`);

        return false;
      }
      if (!validValues.includes(desiredValue)) {
        errors.push(`Invalid value for "${ fqname }": <${ JSON.stringify(desiredValue) }>; ${ explanation }`);
        this.isFatal = true;

        return false;
      }

      return currentValue !== desiredValue;
    };
  }

  protected checkString<S>(mergedSettings: S, currentValue: string, desiredValue: string, errors: string[], fqname: string): boolean {
    if (typeof desiredValue !== 'string') {
      errors.push(this.invalidSettingMessage(fqname, desiredValue));

      return false;
    }

    return currentValue !== desiredValue;
  }

  protected checkKubernetesVersion(mergedSettings: Settings, currentValue: string, desiredVersion: string, errors: string[], _: string): boolean {
    /**
     * desiredVersion can be an empty string when Kubernetes is disabled, but otherwise it must be a valid version.
    */
    if ((mergedSettings.kubernetes.enabled || desiredVersion !== '') && !this.k8sVersions.includes(desiredVersion)) {
      errors.push(`Kubernetes version "${ desiredVersion }" not found.`);

      return false;
    }

    return currentValue !== desiredVersion;
  }

  protected notSupported(fqname: string) {
    return `Changing field "${ fqname }" via the API isn't supported.`;
  }

  protected checkUnchanged<S>(mergedSettings: S, currentValue: any, desiredValue: any, errors: string[], fqname: string): boolean {
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
  protected checkBooleanMapping<S>(mergedSettings: S, currentValue: Record<string, boolean>, desiredValue: Record<string, boolean>, errors: string[], fqname: string): boolean {
    if (typeof (desiredValue) !== 'object') {
      errors.push(`Proposed field "${ fqname }" should be an object, got <${ desiredValue }>.`);

      return false;
    }

    let changed = Object.keys(currentValue).some(k => !(k in desiredValue));

    for (const [key, value] of Object.entries(desiredValue)) {
      if (typeof value !== 'boolean' && value !== null) {
        errors.push(this.invalidSettingMessage(`${ fqname }.${ key }`, desiredValue[key]));
      } else {
        changed ||= currentValue[key] !== value;
      }
    }

    return errors.length === 0 && changed;
  }

  protected checkUniqueStringArray<S>(mergedSettings: S, currentValue: string[], desiredValue: string[], errors: string[], fqname: string): boolean {
    if (!Array.isArray(desiredValue) || desiredValue.some(s => typeof (s) !== 'string')) {
      errors.push(this.invalidSettingMessage(fqname, desiredValue));

      return false;
    }
    const duplicateValues = this.findDuplicates(desiredValue);

    if (duplicateValues.length > 0) {
      duplicateValues.sort(Intl.Collator().compare);
      errors.push(`field "${ fqname }" has duplicate entries: "${ duplicateValues.join('", "') }"`);

      return false;
    }

    return currentValue.length !== desiredValue.length || currentValue.some((v, i) => v !== desiredValue[i]);
  }

  protected findDuplicates(list: string[]): string[] {
    let whiteSpaceMembers = [];
    const firstInstance = new Set<string>();
    const duplicates = new Set<string>();
    const isWhiteSpaceRE = /^\s*$/;

    for (const member of list) {
      if (isWhiteSpaceRE.test(member)) {
        whiteSpaceMembers.push(member);
      } else if (!firstInstance.has(member)) {
        firstInstance.add(member);
      } else {
        duplicates.add(member);
      }
    }
    if (whiteSpaceMembers.length === 1) {
      whiteSpaceMembers = [];
    }

    return Array.from(duplicates).concat(whiteSpaceMembers);
  }

  protected checkInstalledExtensions(
    mergedSettings: Settings,
    currentValue: Record<string, string>,
    desiredValue: any,
    errors: string[],
    fqname: string,
  ): boolean {
    if (_.isEqual(desiredValue, currentValue)) {
      // Accept no-op changes
      return false;
    }

    if (typeof desiredValue !== 'object' || !desiredValue) {
      errors.push(`${ fqname }: "${ desiredValue }" is not a valid mapping`);

      return false;
    }

    for (const [name, tag] of Object.entries(desiredValue)) {
      if (!validateImageName(name)) {
        errors.push(`${ fqname }: "${ name }" is an invalid name`);
      }
      if (typeof tag !== 'string') {
        errors.push(`${ fqname }: "${ name }" has non-string tag "${ tag }"`);
      } else if (!validateImageTag(tag)) {
        errors.push(`${ fqname }: "${ name }" has invalid tag "${ tag }"`);
      }
    }

    return !_.isEqual(desiredValue, currentValue);
  }

  protected checkExtensionAllowList(
    mergedSettings: Settings,
    currentValue: string[],
    desiredValue: any,
    errors: string[],
    fqname: string,
  ): boolean {
    if (_.isEqual(desiredValue, currentValue)) {
      // Accept no-op changes
      return false;
    }

    const changed = this.checkUniqueStringArray(mergedSettings, currentValue, desiredValue, errors, fqname);

    if (errors.length) {
      return changed;
    }

    for (const pattern of desiredValue as string[]) {
      if (!parseImageReference(pattern, true)) {
        errors.push(`${ fqname }: "${ pattern }" does not describe an image reference`);
      }
    }

    return errors.length === 0 && changed;
  }

  protected checkPreferencesNavItemCurrent(
    mergedSettings: TransientSettings,
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
    mergedSettings: TransientSettings,
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

      if (_.isEqual(currentValue[k as NavItemName], desiredValue[k])) {
        // If the setting is unchanged, allow any value.  This is needed if some
        // settings are not applicable for a platform.
        continue;
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
      containerEngine: { name: this.canonicalizeContainerEngine },
      kubernetes:      { version: this.canonicalizeKubernetesVersion },
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
    const desiredValue: boolean | string = newSettings[index];

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
