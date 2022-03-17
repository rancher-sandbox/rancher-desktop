type settingsLike = Record<string, any>;

export default class SettingsValidator {
  k8sVersions: Array<string> = [];
  allowedSettings: settingsLike|null = null;

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
        WSLIntegrations:            this.checkObjectUnchanged,
        options:                    { traefik: this.checkUnchanged },
      },
      portForwarding: { includeKubernetesServices: this.checkUnchanged },
      images:         {
        showAll:   this.checkUnchanged,
        namespace:  this.checkUnchanged,
      },
      telemetry: this.checkUnchanged,
      updater:   this.checkUnchanged,
      debug:     this.checkUnchanged
    };
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
        errors.push(`Setting name ${ fqname } isn't recognized.`);
      } else if (typeof (allowedSettings[k]) === 'object') {
        if (typeof (newSettings[k]) === 'object') {
          changeNeeded = this.checkProposedSettings(allowedSettings[k], currentSettings[k], newSettings[k], errors, fqname) || changeNeeded;
        } else {
          errors.push(`Setting ${ fqname } should wrap an inner object, but got <${ newSettings[k] }>.`);
        }
      } else if (typeof (newSettings[k]) === 'object') {
        if (allowedSettings[k] === this.checkObjectUnchanged) {
          // Special case for things like `.WSLIntegrations` which have unknown fields.
          changeNeeded = this.checkObjectUnchanged(newSettings[k], currentSettings[k], errors, fqname) || changeNeeded;
        } else {
          // newSettings[k] should be valid JSON because it came from `JSON.parse(incoming-payload)`.
          // It's an internal error (HTTP Status 500) if it isn't.
          errors.push(`Setting ${ fqname } should be a simple value, but got <${ JSON.stringify(newSettings[k]) }>.`);
        }
      } else {
        // Throw an exception if this field isn't a function, because in the verifier all values should be
        // either child objects or functions.
        changeNeeded = allowedSettings[k].call(this, currentSettings[k], newSettings[k], errors, fqname) || changeNeeded;
        if (changeNeeded && fqname === 'kubernetes.containerEngine' && newSettings[k] === 'docker') {
          newSettings[k] = 'moby';
        }
      }
    }

    return changeNeeded;
  }

  protected checkContainerEngine(currentValue: string, desiredEngine: string, errors: string[], fqname: string): boolean {
    switch (desiredEngine) {
    case 'containerd':
    case 'moby':
      break;
    case 'docker':
      desiredEngine = 'moby';
      break;
    default:
      errors.push(`Invalid value for ${ fqname }: <${ desiredEngine }>; must be 'containerd', 'docker', or 'moby'`);

      return false;
    }

    return currentValue !== desiredEngine;
  }

  protected checkEnabled(currentState: boolean, desiredState: string|boolean, errors: string[], fqname: string): boolean {
    if (typeof (desiredState) !== 'boolean') {
      switch (desiredState) {
      case 'true':
        desiredState = true;
        break;
      case 'false':
        desiredState = false;
        break;
      default:
        errors.push(`Invalid value for ${ fqname }: <${ desiredState }>`);

        return false;
      }
    }

    return currentState !== desiredState;
  }

  protected checkKubernetesVersion(currentValue: string, desiredVersion: string, errors: string[], fqname: string): boolean {
    const ptn = /^v?(\d+\.\d+\.\d+)(?:\+k3s\d+)?$/;
    const m = ptn.exec(desiredVersion);

    if (!m) {
      errors.push(`Desired kubernetes version not valid: <${ desiredVersion }>`);

      return false;
    }
    desiredVersion = m[1];
    if (this.k8sVersions.length === 0) {
      errors.push(`Can't check field ${ fqname }: no versions of Kubernetes were found.`);

      return false;
    } else if (!this.k8sVersions.includes(desiredVersion)) {
      errors.push(`Kubernetes version ${ desiredVersion } not found.`);

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
  protected stableSerialize(value: Record<string, boolean>) {
    return JSON.stringify(Object.entries(value).sort());
  }

  protected checkObjectUnchanged(currentValue: any, desiredValue: any, errors: string[], fqname: string): boolean {
    if (typeof (desiredValue) !== 'object') {
      errors.push(`Proposed field ${ fqname } should be an object, got <${ desiredValue }>.`);

      return false;
    }
    try {
      if (this.stableSerialize(currentValue) !== this.stableSerialize(desiredValue)) {
        errors.push(this.notSupported(fqname));
      }
    } catch (err) {
      errors.push(`JSON-parsing error checking field ${ fqname }: ${ err }`);
    }

    return false;
  }
}
