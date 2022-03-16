import { Settings } from '@/config/settings';

type validationFunc = (desiredValue: string|boolean|Record<string, any>, errors: string[], fqname: string) => boolean;

export default class SettingsValidator {
  k8sVersions: Array<string> = [];
  cfg: Settings;
  allowedSettings: Record<string, validationFunc|any>|null = null;

  constructor(cfg: Settings) {
    this.cfg = cfg;
  }

  validateSettings(newSettings: Record<string, any>): [boolean, string[]] {
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
    const needToUpdate = this.checkProposedSettings(this.allowedSettings, newSettings, errors, '');

    return [needToUpdate, errors];
  }

  /**
   * The core function for checking proposed user settings.
   * Walks the input: the user-provided object holding the new (and existing settings) against a verifier:
   * 1. Complains about any fields in the input that aren't in the verifier
   * 2. Recursively walks child-objects in the input and verifier
   * 3. Calls validation functions off the verifier
   * @param allowedSettings - The verifier
   * @param newSettings - User's proposed new settings
   * @param errors - Builds this list up as new errors are encountered, so multiple errors can be reported.
   * @param prefix - For error messages only, e.g. '' for root, 'kubernetes.options', etc.
   * @returns boolean - true if there are changes that need to be applied.
   */
  protected checkProposedSettings(
    allowedSettings: Record<string, validationFunc|any>,
    newSettings: Record<string, any>,
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
          changeNeeded = this.checkProposedSettings(allowedSettings[k], newSettings[k], errors, fqname) || changeNeeded;
        } else {
          errors.push(`Setting ${ fqname } should wrap an inner object, but got <${ newSettings[k] }>.`);
        }
      } else if (typeof (newSettings[k]) === 'object') {
        if (allowedSettings[k] === this.checkObjectUnchanged) {
          // Special case for things like `.WSLIntegrations` which have unknown fields.
          changeNeeded = this.checkObjectUnchanged(newSettings[k], errors, fqname) || changeNeeded;
        } else {
          // newSettings[k] should be valid JSON because it came from `JSON.parse(incoming-payload)`.
          // It's an internal error (HTTP Status 500) if it isn't.
          errors.push(`Setting ${ fqname } should be a simple value, but got <${ JSON.stringify(newSettings[k]) }>.`);
        }
      } else {
        // Throw an exception if this field isn't a function, because in the verifier all values should be
        // either child objects or functions.
        changeNeeded = allowedSettings[k].call(this, newSettings[k], errors, fqname) || changeNeeded;
      }
    }

    return changeNeeded;
  }

  protected checkContainerEngine(desiredEngine: string, errors: string[], fqname: string): boolean {
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

    return this.cfg.kubernetes.containerEngine !== desiredEngine;
  }

  protected checkEnabled(desiredState: string|boolean, errors: string[], fqname: string): boolean {
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

    return this.cfg.kubernetes.enabled !== desiredState;
  }

  protected checkKubernetesVersion(desiredVersion: string, errors: string[], fqname: string): boolean {
    const ptn = /^v?(\d+\.\d+\.\d+)(?:\+k3s\d+)?$/;
    let m = ptn.exec(desiredVersion);

    if (!m) {
      errors.push(`Desired kubernetes version not valid: <${ desiredVersion }>`);

      return false;
    }
    desiredVersion = m[1];
    m = ptn.exec(this.cfg.kubernetes.version);
    if (!m) {
      errors.push(`Field kubernetes.version: not a valid Kubernetes version: <${ this.cfg.kubernetes.version }>`);

      return false;
    }

    const actualVersion = m[1];

    if (this.k8sVersions.length === 0) {
      errors.push(`Can't check field ${ fqname }: no versions of Kubernetes were found.`);

      return false;
    } else if (!this.k8sVersions.includes(desiredVersion)) {
      errors.push(`Kubernetes version ${ desiredVersion } not found.`);

      return false;
    }

    return actualVersion !== desiredVersion;
  }

  protected notSupported(fqname: string) {
    return `Changing field ${ fqname } via the API isn't supported.`;
  }

  protected checkUnchanged(desiredValue: any, errors: string[], fqname: string): boolean {
    const existingValue = fqname.split('.').reduce((prefs: Record<string, any>, curr: string) => prefs[curr], this.cfg);

    if (existingValue !== desiredValue) {
      errors.push(this.notSupported(fqname));
    }

    return false;
  }

  protected checkObjectUnchanged(desiredValue: any, errors: string[], fqname: string): boolean {
    if (typeof (desiredValue) !== 'object') {
      errors.push(`Proposed field ${ fqname } should be an object, got <${ desiredValue }>.`);

      return false;
    }
    const existingValue = fqname.split('.').reduce((prefs: Record<string, any>, curr: string) => prefs[curr], this.cfg);

    try {
      if (JSON.stringify(existingValue) !== JSON.stringify(desiredValue)) {
        errors.push(this.notSupported(fqname));
      }
    } catch (err) {
      errors.push(`JSON-parsing error checking field ${ fqname }: ${ err }`);
    }

    return false;
  }
}
