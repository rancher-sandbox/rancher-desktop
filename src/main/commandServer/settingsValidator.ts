import { PathManagementStrategy } from '@/integrations/pathManager';

type settingsLike = Record<string, any>;

export default class SettingsValidator {
  k8sVersions: Array<string> = [];
  allowedSettings: settingsLike|null = null;
  synonymsTable: settingsLike|null = null;

  validateSettings(currentSettings: settingsLike, newSettings: settingsLike): [boolean, string[]] {
    this.allowedSettings ||= {
      version:    this.checkUnchanged,
      kubernetes: {
        version:                    this.checkKubernetesVersion,
        memoryInGB:                 this.checkUnchanged,
        numberCPUs:                 this.checkUnchanged,
        port:                       this.checkUnchanged,
        containerEngine:            this.checkContainerEngine,
        checkForExistingKimBuilder: this.checkUnchanged,
        enabled:                    this.checkEnabled,
        WSLIntegrations:            this.checkWSLIntegrations,
        options:                    { traefik: this.checkUnchanged },
      },
      portForwarding: { includeKubernetesServices: this.checkUnchanged },
      images:         {
        showAll:   this.checkUnchanged,
        namespace:  this.checkUnchanged,
      },
      telemetry:              this.checkUnchanged,
      updater:                this.checkUnchanged,
      debug:                  this.checkUnchanged,
      pathManagementStrategy: this.checkPathManagementStrategy,
    };
    this.canonicalizeSynonyms(newSettings);
    const errors: Array<string> = [];
    const needToUpdate = this.checkProposedSettings(this.allowedSettings, currentSettings, newSettings, errors, '');

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
        if (allowedSettings[k] === this.checkWSLIntegrations) {
          // Special case for things like `.WSLIntegrations` which have unknown fields.
          changeNeeded = this.checkWSLIntegrations(currentSettings[k], newSettings[k], errors, fqname) || changeNeeded;
        } else {
          // newSettings[k] should be valid JSON because it came from `JSON.parse(incoming-payload)`.
          // It's an internal error (HTTP Status 500) if it isn't.
          errors.push(`Setting ${ fqname } should be a simple value, but got <${ JSON.stringify(newSettings[k]) }>.`);
        }
      } else {
        // Throw an exception if this field isn't a function, because in the verifier all values should be
        // either child objects or functions.
        changeNeeded = allowedSettings[k].call(this, currentSettings[k], newSettings[k], errors, fqname) || changeNeeded;
      }
    }

    return changeNeeded;
  }

  protected checkContainerEngine(currentValue: string, desiredEngine: string, errors: string[], fqname: string): boolean {
    if (!['containerd', 'moby'].includes(desiredEngine)) {
      // The error message says 'docker' is ok, although it should have been converted to 'moby' by now.
      // But the word "'docker'" is valid in a raw API call.
      errors.push(`Invalid value for ${ fqname }: <${ desiredEngine }>; must be 'containerd', 'docker', or 'moby'`);

      return false;
    }

    return currentValue !== desiredEngine;
  }

  protected checkEnabled(currentState: boolean, desiredState: string|boolean, errors: string[], fqname: string): boolean {
    if (typeof (desiredState) !== 'boolean') {
      errors.push(`Invalid value for ${ fqname }: <${ desiredState }>`);

      return false;
    }

    return currentState !== desiredState;
  }

  protected checkKubernetesVersion(currentValue: string, desiredVersion: string, errors: string[], _: string): boolean {
    if (!this.k8sVersions.includes(desiredVersion)) {
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

  // only arrays support stringification, so convert objects to arrays of tuples and sort on the keys
  protected stableSerializeWSLIntegrations(value: Record<string, boolean>) {
    return JSON.stringify(Object.entries(value).sort());
  }

  protected checkWSLIntegrations(currentValue: Record<string, boolean>, desiredValue: Record<string, boolean>, errors: string[], fqname: string): boolean {
    if (typeof (desiredValue) !== 'object') {
      errors.push(`Proposed field ${ fqname } should be an object, got <${ desiredValue }>.`);

      return false;
    }
    try {
      if (this.stableSerializeWSLIntegrations(currentValue) !== this.stableSerializeWSLIntegrations(desiredValue)) {
        errors.push(this.notSupported(fqname));
      }
    } catch (err) {
      errors.push(`JSON-parsing error checking field ${ fqname }: ${ err }`);
    }

    return false;
  }

  protected checkPathManagementStrategy(currentValue: PathManagementStrategy,
    desiredValue: any, errors: string[], fqname: string): boolean {
    if (!(Object.values(PathManagementStrategy).includes(desiredValue))) {
      errors.push(`${ fqname }: "${ desiredValue }" is not a valid strategy`);

      return false;
    }
    if (desiredValue !== currentValue) {
      return true;
    }

    return false;
  }

  canonicalizeSynonyms(newSettings: settingsLike): void {
    this.synonymsTable ||= {
      kubernetes: {
        version:         this.canonicalizeKubernetesVersion,
        containerEngine: this.canonicalizeContainerEngine,
        enabled:         this.canonicalizeKubernetesEnabled,
      }
    };
    this.canonicalizeSettings(this.synonymsTable, newSettings, '');
  }

  protected canonicalizeSettings(synonymsTable: settingsLike, newSettings: settingsLike, prefix: string): void {
    for (const k in newSettings) {
      const fqname = prefix ? `${ prefix }.${ k }` : k;

      if (k in synonymsTable) {
        if (typeof (synonymsTable[k]) === 'object') {
          return this.canonicalizeSettings(synonymsTable[k], newSettings[k], fqname);
        } else {
          synonymsTable[k].call(this, newSettings, k);
        }
      // else: ignore unrecognized fields, because we don't need to change everything
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

  protected canonicalizeKubernetesEnabled(newSettings: settingsLike, index: string): void {
    const desiredValue: boolean|string = newSettings[index];

    if (desiredValue === 'true') {
      newSettings[index] = true;
    } else if (desiredValue === 'false') {
      newSettings[index] = false;
    }
  }
}
