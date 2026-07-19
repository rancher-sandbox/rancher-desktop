import net from 'net';
import os from 'os';

import _ from 'lodash';
import semver from 'semver';

import {
  CacheMode,
  ContainerEngine,
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
import { availableLocales, t } from '@pkg/main/i18n';
import { parseImageReference, validateImageName, validateImageTag } from '@pkg/utils/dockerUtils';
import { stripNoproxyPrefix } from '@pkg/utils/networks';
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
type ValidatorFunc<S, C, D, N extends string> =
  (mergedSettings: S, currentValue: C, desiredValue: D, errors: string[], fqname: N) => boolean;

/**
 * SettingsValidationMapEntry describes validators that are valid for some
 * subtree of the full settings object.  The value must be either a ValidatorFunc
 * for that subtree, or an object containing validators for each member of the
 * subtree.
 */
type SettingsValidationMapEntry<S, T, N extends string = ''> = {
  [k in keyof T]:
  k extends string ?
    T[k] extends string | string[] | number | boolean ?
      ValidatorFunc<S, T[k], T[k], N extends '' ? k : `${ N }.${ k }`> :
      T[k] extends Record<string, infer V> ?
        SettingsValidationMapEntry<S, T[k], N extends '' ? k : `${ N }.${ k }`> |
          ValidatorFunc<S, T[k], Record<string, V>, N extends '' ? k : `${ N }.${ k }`> :
        never :
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
  hasLockedFieldError = false;

  validateSettings(
    currentSettings: Settings,
    newSettings: RecursivePartial<Settings>,
    lockedSettings: LockedSettingsType = {},
  ): [boolean, string[], boolean] {
    this.lockedSettings = lockedSettings;
    this.isFatal = false;
    this.hasLockedFieldError = false;
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
        locale:                 this.checkEnum(...availableLocales),
        window:                 { quitOnClose: this.checkBoolean },
        theme:                  this.checkEnum('system', 'light', 'dark'),
      },
      containerEngine: {
        allowedImages: {
          enabled:  this.checkBoolean,
          patterns: this.checkUniqueStringArray,
        },
        mobyStorageDriver: this.checkMulti(
          this.checkEnum('classic', 'snapshotter', 'auto'),
          this.checkWASMWithMobyStorage,
        ),
        name: this.checkMulti(
          // 'docker' has been canonicalized to 'moby' already, but we want to include it as a valid value in the error message
          this.checkEnum('containerd', 'moby', 'docker'),
          this.checkWASMWithMobyStorage,
        ),
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
        containerEngine: { webAssembly: { enabled: this.checkMulti(this.checkBoolean, this.checkWASMWithMobyStorage) } },
        kubernetes:      { options: { spinkube: this.checkMulti(this.checkBoolean, this.checkSpinkube) } },
        virtualMachine:  {
          diskSize: this.checkLima(this.checkByteUnits),
          mount:    {
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
            noproxy:  this.checkPlatform('win32', this.checkNoproxyList),
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
        mutedChecks:  this.checkBooleanMapping,
        showMuted:    this.checkBoolean,
        connectivity: {
          interval: this.checkNumber(0, 2 ** 31 - 1),
          timeout:  this.checkNumber(1, 2 ** 31 - 1),
        },
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
          errors.push(t('validation.shouldBeObject', { field: fqname, value: newSettings[k] }));
        }
      } else if (typeof (newSettings[k]) === 'object') {
        if (typeof allowedSettings[k] === 'function') {
          // Special case for things like `.WSLIntegrations` which have unknown fields.
          const validator: ValidatorFunc<S, any, any, any> = allowedSettings[k];

          changeNeededHere = validator.call(this, mergedSettings, currentSettings[k], newSettings[k], errors, fqname);
        } else {
          // newSettings[k] should be valid JSON because it came from `JSON.parse(incoming-payload)`.
          // It's an internal error (HTTP Status 500) if it isn't.
          errors.push(t('validation.shouldBeSimple', { field: fqname, value: JSON.stringify(newSettings[k]) }));
        }
      } else if (typeof allowedSettings[k] === 'function') {
        const validator: ValidatorFunc<S, any, any, any> = allowedSettings[k];

        changeNeededHere = validator.call(this, mergedSettings, currentSettings[k], newSettings[k], errors, fqname);
      } else {
        errors.push(this.notSupported(fqname));
      }
      if (changeNeededHere) {
        const isLocked = _.get(this.lockedSettings, fqname);

        if (isLocked) {
          // A delayed error condition, raised only if we try to change a field in a locked object.
          // Callers check hasLockedFieldError to detect this condition without
          // parsing the translated error message.
          errors.push(t('validation.fieldLocked', { field: fqname }));
          this.isFatal = true;
          this.hasLockedFieldError = true;
        } else {
          changeNeeded = true;
        }
      }
    }

    return changeNeeded;
  }

  // Validation messages are locale-dependent. The CLI and HTTP API return
  // these strings directly, so callers must not parse them; classification
  // uses structured flags like hasLockedFieldError.
  protected invalidSettingMessage(fqname: string, desiredValue: any): string {
    return t('validation.invalidValue', { field: fqname, value: JSON.stringify(desiredValue) });
  }

  /**
   * checkLima ensures that the given parameter is only set on Lima-based platforms.
   * @note This should not be used for things with default values.
   */
  protected checkLima<C, D, N extends string>(validator: ValidatorFunc<Settings, C, D, N>) {
    return (mergedSettings: Settings, currentValue: C, desiredValue: D, errors: string[], fqname: N) => {
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
        errors.push(t('validation.requiresVz', { field: fqname, vmType: VMType.VZ }));
        this.isFatal = true;

        return false;
      }
      if (process.arch !== 'arm64') {
        errors.push(t('validation.requiresArm', { field: fqname }));
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
        errors.push(t('validation.vzArmMacOs', { field: fqname, vmType: VMType.VZ }));

        return false;
      } else if (semver.gt('13.0.0', getMacOsVersion())) {
        this.isFatal = true;
        errors.push(t('validation.vzIntelMacOs', { field: fqname, vmType: VMType.VZ }));

        return false;
      }
      if (mergedSettings.virtualMachine.mount.type === MountType.NINEP) {
        errors.push(
          t('validation.settingRequiresEither', {
            field:      fqname,
            value:      VMType.VZ,
            otherField: 'virtual-machine.mount.type',
            option1:    MountType.REVERSE_SSHFS,
            option2:    MountType.VIRTIOFS,
          }));

        return false;
      }
    }
    if (desiredValue === VMType.QEMU) {
      if (mergedSettings.virtualMachine.mount.type === MountType.VIRTIOFS && os.platform() === 'darwin') {
        errors.push(
          t('validation.settingRequiresEither', {
            field:      fqname,
            value:      VMType.QEMU,
            otherField: 'virtual-machine.mount.type',
            option1:    MountType.REVERSE_SSHFS,
            option2:    MountType.NINEP,
          }));

        return false;
      }
    }

    return currentValue !== desiredValue;
  }

  protected checkMountType(mergedSettings: Settings, currentValue: string, desiredValue: string, errors: string[], fqname: string): boolean {
    if (desiredValue === MountType.VIRTIOFS && mergedSettings.virtualMachine.type !== VMType.VZ && os.platform() === 'darwin') {
      errors.push(t('validation.settingRequires', { field: fqname, value: MountType.VIRTIOFS, otherField: 'virtual-machine.type', required: VMType.VZ }));
      this.isFatal = true;

      return false;
    }
    if (desiredValue === MountType.VIRTIOFS && mergedSettings.virtualMachine.type !== VMType.QEMU && os.platform() === 'linux') {
      errors.push(t('validation.settingRequires', { field: fqname, value: MountType.VIRTIOFS, otherField: 'virtual-machine.type', required: VMType.QEMU }));
      this.isFatal = true;

      return false;
    }
    if (desiredValue === MountType.NINEP && mergedSettings.virtualMachine.type !== VMType.QEMU) {
      errors.push(t('validation.settingRequires', { field: fqname, value: MountType.NINEP, otherField: 'virtual-machine.type', required: VMType.QEMU }));
      this.isFatal = true;

      return false;
    }

    return currentValue !== desiredValue;
  }

  protected checkSpinkube(mergedSettings: Settings, currentValue: boolean, desiredValue: boolean, errors: string[], fqname: string): boolean {
    if (mergedSettings.kubernetes.enabled && desiredValue) {
      if (!mergedSettings.experimental.containerEngine.webAssembly.enabled) {
        errors.push(t('validation.requiresWebAssembly', { field: fqname }));
        this.isFatal = true;

        return false;
      }
    }

    return currentValue !== desiredValue;
  }

  // checkWASMWithMobyStorage checks that we can't use classic storage for moby
  // in combination with WASM.
  protected checkWASMWithMobyStorage<
    T,
    N extends 'containerEngine.name' | 'containerEngine.mobyStorageDriver' | 'experimental.containerEngine.webAssembly.enabled',
  >(mergedSettings: Settings, currentValue: T, desiredValue: T, errors: string[], fqname: N): boolean {
    if (mergedSettings.containerEngine.name === ContainerEngine.MOBY &&
        mergedSettings.experimental.containerEngine.webAssembly.enabled &&
        mergedSettings.containerEngine.mobyStorageDriver === 'classic'
    ) {
      const message: string = {
        'containerEngine.name':                             t('validation.cannotSwitchMobyClassicWasm'),
        'experimental.containerEngine.webAssembly.enabled': t('validation.cannotEnableWasmClassic'),
        'containerEngine.mobyStorageDriver':                t('validation.cannotSwitchClassicWasm'),
      }[fqname];

      if (currentValue !== desiredValue) {
        errors.push(message);
        this.isFatal = true;
      }
    }
    return currentValue !== desiredValue;
  }

  protected checkPlatform<C, D, N extends string>(platform: NodeJS.Platform, validator: ValidatorFunc<Settings, C, D, N>) {
    return (mergedSettings: Settings, currentValue: C, desiredValue: D, errors: string[], fqname: N) => {
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

  protected check9P<C, D, N extends string>(validator: ValidatorFunc<Settings, C, D, N>) {
    return (mergedSettings: Settings, currentValue: C, desiredValue: D, errors: string[], fqname: N) => {
      if (mergedSettings.virtualMachine.mount.type !== MountType.NINEP) {
        if (!_.isEqual(currentValue, desiredValue)) {
          errors.push(t('validation.requiresNineP', { field: fqname, mountType: MountType.NINEP }));
          this.isFatal = true;
        }

        return false;
      }

      return validator.call(this, mergedSettings, currentValue, desiredValue, errors, fqname);
    };
  }

  protected checkMulti<S, C, D, N extends string>(...validators: ValidatorFunc<S, C, D, N>[]) {
    return (mergedSettings: S, currentValue: C, desiredValue: D, errors: string[], fqname: N) => {
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
      if (typeof desiredValue !== 'string') {
        errors.push(t('validation.invalidValueEnum', {
          field: fqname, value: JSON.stringify(desiredValue), validValues: JSON.stringify(validValues),
        }));

        return false;
      }
      if (!validValues.includes(desiredValue)) {
        errors.push(t('validation.invalidValueEnum', {
          field: fqname, value: JSON.stringify(desiredValue), validValues: JSON.stringify(validValues),
        }));
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

  /**
   * Parse a string representing a number of bytes into a number, in a way that
   * is compatible with `github.com/docker/go-units`.
   * @param input The string to parse.
   * @returns The parsed number, or `undefined` if the input is not valid.
   */
  protected parseByteUnits(input: string): number | undefined {
    const expression = /^(\d+(?:\.\d+)?) ?([kmgtpezy]?)(i?b)?$/i; // spellcheck-ignore-line
    const prefix = ['', 'k', 'm', 'g', 't', 'p', 'e', 'z', 'y'];
    const match = expression.exec(input);

    if (!match) {
      return undefined;
    }

    const [, number, scale, unit] = match;
    const base = unit?.startsWith('i') ? 1_024 : 1_000;
    const exponent = prefix.indexOf(scale.toLowerCase() ?? '');

    return parseFloat(number) * base ** exponent;
  }

  /**
   * Check that the setting is a valid number of bytes, per `github.com/docker/go-units`.
   */
  protected checkByteUnits(_: Settings, currentValue: string, desiredValue: string, errors: string[], fqname: string): boolean {
    const current = this.parseByteUnits(currentValue);
    const desired = this.parseByteUnits(desiredValue);

    if (typeof desired === 'undefined') {
      errors.push(this.invalidSettingMessage(fqname, desiredValue));
    } else if (typeof current !== 'undefined' && desired < current) {
      errors.push(t('validation.cannotDecrease', { field: fqname, from: currentValue, to: desiredValue }));
    } else {
      return currentValue !== desiredValue;
    }

    return false;
  }

  protected checkKubernetesVersion(mergedSettings: Settings, currentValue: string, desiredVersion: string, errors: string[], _: string): boolean {
    /**
     * desiredVersion can be an empty string when Kubernetes is disabled, but otherwise it must be a valid version.
    */
    if ((mergedSettings.kubernetes.enabled || desiredVersion !== '') && !this.k8sVersions.includes(desiredVersion)) {
      errors.push(t('validation.kubernetesVersionNotFound', { version: desiredVersion }));

      return false;
    }

    return currentValue !== desiredVersion;
  }

  protected notSupported(fqname: string) {
    return t('validation.notSupported', { field: fqname });
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
      errors.push(t('validation.proposedShouldBeObject', { field: fqname, value: desiredValue }));

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
      errors.push(t('validation.duplicateEntries', { field: fqname, duplicates: duplicateValues.join('", "') }));

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

  /**
   * Validate that a string is an IP address or CIDR subnet.
   * Accepts IPv4 and IPv6 addresses with optional prefix length.
   */
  protected static isIPAddressOrCIDR(entry: string): boolean {
    const slashIndex = entry.indexOf('/');

    if (slashIndex === -1) {
      return net.isIP(entry) !== 0;
    }
    const address = entry.substring(0, slashIndex);
    const prefixStr = entry.substring(slashIndex + 1);
    const ipVersion = net.isIP(address);

    if (ipVersion === 0) {
      return false;
    }
    if (!/^\d+$/.test(prefixStr)) {
      return false;
    }
    const prefix = parseInt(prefixStr, 10);
    const maxPrefix = ipVersion === 4 ? 32 : 128;

    return prefix >= 0 && prefix <= maxPrefix;
  }

  /**
   * Validate that a string is a domain name, optionally with a wildcard prefix.
   * Accepts "example.com", "*.example.com", and ".example.com" (NO_PROXY convention).
   */
  protected static isDomainName(entry: string): boolean {
    const domain = stripNoproxyPrefix(entry);

    if (domain.length === 0 || domain.length > 253) {
      return false;
    }
    // Reject prefixed IP addresses like "*.10.0.0.1" or ".10.0.0.1".
    if (net.isIP(domain) !== 0) {
      return false;
    }
    const labels = domain.split('.');
    const labelRE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

    return labels.every(label => labelRE.test(label));
  }

  /**
   * Validate the noproxy list: must be unique strings, each a valid IP address,
   * CIDR subnet, domain name, or wildcard domain.
   */
  protected checkNoproxyList<S>(mergedSettings: S, currentValue: string[], desiredValue: string[], errors: string[], fqname: string): boolean {
    if (!Array.isArray(desiredValue) || desiredValue.some(s => typeof (s) !== 'string')) {
      errors.push(this.invalidSettingMessage(fqname, desiredValue));

      return false;
    }
    const duplicateValues = this.findDuplicates(desiredValue);

    if (duplicateValues.length > 0) {
      duplicateValues.sort(Intl.Collator().compare);
      errors.push(t('validation.duplicateEntries', { field: fqname, duplicates: duplicateValues.join('", "') }));

      return false;
    }
    const invalidEntries = desiredValue.filter(entry => !SettingsValidator.isIPAddressOrCIDR(entry) && !SettingsValidator.isDomainName(entry));

    if (invalidEntries.length > 0) {
      errors.push(t('validation.invalidNoproxyEntries', { field: fqname, entries: invalidEntries.join('", "') }));

      return false;
    }

    return currentValue.length !== desiredValue.length || currentValue.some((v, i) => v !== desiredValue[i]);
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
      errors.push(t('validation.invalidMapping', { field: fqname, value: desiredValue }));

      return false;
    }

    for (const [name, tag] of Object.entries(desiredValue)) {
      if (!validateImageName(name)) {
        errors.push(t('validation.invalidName', { field: fqname, name }));
      }
      if (typeof tag !== 'string') {
        errors.push(t('validation.nonStringTag', { field: fqname, name, tag: String(tag) }));
      } else if (!validateImageTag(tag)) {
        errors.push(t('validation.invalidTag', { field: fqname, name, tag }));
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
        errors.push(t('validation.invalidImageReference', { field: fqname, pattern }));
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
      errors.push(t('validation.invalidPageName', { field: fqname, value: desiredValue }));

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
        errors.push(t('validation.invalidPageName', { field: fqname, value: k }));

        return false;
      }

      if (_.isEqual(currentValue[k as NavItemName], desiredValue[k])) {
        // If the setting is unchanged, allow any value.  This is needed if some
        // settings are not applicable for a platform.
        continue;
      }

      const navItem = preferencesNavItems.find(item => item.name === k);

      if (!navItem?.tabs?.includes(desiredValue[k])) {
        errors.push(t('validation.invalidTabName', { field: fqname, tabName: desiredValue[k], page: k }));

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
