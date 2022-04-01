import _ from 'lodash';
import SettingsValidator from '../settingsValidator';
import * as settings from '@/config/settings';
import { RecursivePartial } from '@/utils/recursivePartialType';

const cfg = settings.init();

cfg.kubernetes.version = '1.23.4';
const currK8sVersion = cfg.kubernetes.version;
const finalK8sVersion = currK8sVersion.replace(/^v?/, '');
const subject = new SettingsValidator();

subject.k8sVersions = [finalK8sVersion, '1.0.0'];
describe(SettingsValidator, () => {
  describe('validateSettings', () => {
    it('should do nothing when given existing settings', () => {
      const [needToUpdate, errors] = subject.validateSettings(cfg, cfg);

      expect(needToUpdate).toBeFalsy();
      expect(errors).toHaveLength(0);
    });

    it('should want to apply changes when valid new settings are proposed', () => {
      const newEnabled = !cfg.kubernetes.enabled;
      const newVersion = subject.k8sVersions[1];
      const newEngine = cfg.kubernetes.containerEngine === 'moby' ? 'containerd' : 'moby';
      const newConfig = _.merge({}, cfg, {
        kubernetes:
          {
            enabled:         newEnabled,
            version:         newVersion,
            containerEngine: newEngine
          }
      });
      const [needToUpdate, errors] = subject.validateSettings(cfg, newConfig);

      expect(needToUpdate).toBeTruthy();
      expect(errors).toHaveLength(0);
    });

    it('should canonicalize and accept near-valid values', () => {
      const newConfig = _.merge({}, cfg, {
        kubernetes:
          {
            enabled:         cfg.kubernetes.enabled ? 'false' : 'true', // force a change
            version:         'v1.23.4+k3s1',
            containerEngine: 'docker'
          }
      });
      const [needToUpdate, errors] = subject.validateSettings(cfg, newConfig);

      expect(needToUpdate).toBeTruthy();
      expect(errors).toHaveLength(0);
    });

    it('should modify valid values that are synonyms for canonical forms', () => {
      const desiredEnabledString = cfg.kubernetes.enabled ? 'false' : 'true';
      const desiredEnabledBoolean = !cfg.kubernetes.enabled;
      const newConfig: Record<string, any> = _.merge({}, cfg, {
        kubernetes:
          {
            enabled:         desiredEnabledString, // force a change
            version:         'v1.23.4+k3s1',
            containerEngine: 'docker'
          }
      });

      subject.canonicalizeSynonyms(newConfig);
      expect(newConfig).toMatchObject({
        kubernetes:
          {
            enabled:         desiredEnabledBoolean,
            version:         '1.23.4',
            containerEngine: 'moby'
          }
      });
    });

    it('should report errors for unchangeable fields', () => {
      const desiredEnabled = !cfg.kubernetes.enabled;
      const desiredEngine = cfg.kubernetes.containerEngine === 'moby' ? 'containerd' : 'moby';
      const requestedSettings = {
        kubernetes:
          {
            enabled:                    desiredEnabled,
            checkForExistingKimBuilder: !cfg.kubernetes.checkForExistingKimBuilder,
            containerEngine:            desiredEngine,
          }
      };
      const [needToUpdate, errors] = subject.validateSettings(cfg, requestedSettings);

      expect(needToUpdate).toBeFalsy();
      expect(errors).toEqual(["Changing field kubernetes.checkForExistingKimBuilder via the API isn't supported."]);
    });

    it('should complain about all unchangeable fields', () => {
      const valuesToChange: [RecursivePartial<settings.Settings>, string][] = [
        [{ version: cfg.version + 1 }, 'version'],
        [{ kubernetes: { memoryInGB: cfg.kubernetes.memoryInGB + 1 } }, 'kubernetes.memoryInGB'],
        [{ kubernetes: { numberCPUs: cfg.kubernetes.numberCPUs + 1 } }, 'kubernetes.numberCPUs'],
        [{ kubernetes: { port: cfg.kubernetes.port + 1 } }, 'kubernetes.port'],
        [{ kubernetes: { checkForExistingKimBuilder: !cfg.kubernetes.checkForExistingKimBuilder } }, 'kubernetes.checkForExistingKimBuilder'],
        [{ kubernetes: { WSLIntegrations: { stuff: 'here' } } }, 'kubernetes.WSLIntegrations'],
        [{
          kubernetes: {
            WSLIntegrations: {
              describe: true, three: false, keys: true
            }
          }
        }, 'kubernetes.WSLIntegrations'],
        [{ kubernetes: { options: { traefik: !cfg.kubernetes.options.traefik } } }, 'kubernetes.options.traefik'],
        [{ portForwarding: { includeKubernetesServices: !cfg.portForwarding.includeKubernetesServices } }, 'portForwarding.includeKubernetesServices'],
        [{ images: { showAll: !cfg.images.showAll } }, 'images.showAll'],
        [{ images: { namespace: '*g0rni9la7tz*' } }, 'images.namespace'],
        [{ telemetry: !cfg.telemetry }, 'telemetry'],
        [{ updater: !cfg.updater }, 'updater'],
        [{ debug: !cfg.debug }, 'debug'],
      ];

      for (const [specifiedSettingSegment, fullQualifiedPreferenceName] of valuesToChange) {
        const [needToUpdate, errors] = subject.validateSettings(cfg, _.merge({}, cfg, specifiedSettingSegment));

        expect(needToUpdate).toBeFalsy();
        expect(errors).toHaveLength(1);
        expect(errors).toEqual([`Changing field ${ fullQualifiedPreferenceName } via the API isn't supported.`]);
      }
    });

    it('should complain about invalid fields', () => {
      const [needToUpdate, errors] = subject.validateSettings(cfg, {
        kubernetes: {
          version:         '1.1.1',
          containerEngine: '1.1.2',
          enabled:         1
        }
      });

      expect(needToUpdate).toBeFalsy();
      expect(errors).toEqual([
        'Kubernetes version "1.1.1" not found.',
        "Invalid value for kubernetes.containerEngine: <1.1.2>; must be 'containerd', 'docker', or 'moby'",
        'Invalid value for kubernetes.enabled: <1>',
      ]);
    });

    it('complains about mismatches between objects and scalars', () => {
      let [needToUpdate, errors] = subject.validateSettings(cfg, { kubernetes: 5 });

      expect(needToUpdate).toBeFalsy();
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Setting kubernetes should wrap an inner object, but got <5>');

      [needToUpdate, errors] = subject.validateSettings(cfg, {
        kubernetes: {
          containerEngine: { expected: 'a string' },
          version:         { expected: 'a string' },
          WSLIntegrations: "ceci n'est pas un objet",
        }
      });
      expect(needToUpdate).toBeFalsy();
      expect(errors).toHaveLength(3);
      expect(errors).toEqual([
        'Setting kubernetes.containerEngine should be a simple value, but got <{"expected":"a string"}>.',
        'Setting kubernetes.version should be a simple value, but got <{"expected":"a string"}>.',
        "Proposed field kubernetes.WSLIntegrations should be an object, got <ceci n'est pas un objet>.",
      ]);
    });

    // Add some fields that are very unlikely to ever collide with newly introduced fields.
    it('should ignore unrecognized settings', () => {
      const [needToUpdate, errors] = subject.validateSettings(cfg, {
        kubernetes: {
          'durian-sharkanodo': 3,
          version:             cfg.version,
          'jackfruit otto':    12,
          options:             {
            'pitaya*paprika': false,
            traefik:          cfg.kubernetes.options.traefik,
          }
        },
        portForwarding: {
          'kiwano // 8 1/2':          'cows',
          includeKubernetesServices: cfg.portForwarding.includeKubernetesServices,
        },
        'feijoa - Alps': []
      });

      expect(needToUpdate).toBeFalsy();
      expect(errors).toHaveLength(1);
    });

    it('should return an error when pathManagementStrategy does not match enum element', () => {
      const newConfig = _.merge({}, cfg, { pathManagementStrategy: 'shouldnevermatch' });
      const [needToUpdate, errors] = subject.validateSettings(cfg, newConfig);

      expect(needToUpdate).toBeFalsy();
      expect(errors).toHaveLength(1);
    });

    it('should want to apply changes when pathManagementStrategy is changed', () => {
      const newConfig = _.merge({}, cfg, { pathManagementStrategy: 'rcfiles' });
      const [needToUpdate, errors] = subject.validateSettings(cfg, newConfig);

      expect(needToUpdate).toBeTruthy();
      expect(errors).toHaveLength(0);
    });
  });
});
