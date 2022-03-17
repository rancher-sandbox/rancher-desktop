import _ from 'lodash';
import SettingsValidator from '../settingsValidator';
import * as settings from '@/config/settings';
import { RecursivePartial } from '~/utils/recursivePartialType';

const cfg = settings.init();

cfg.kubernetes.version ||= '1.23.4';
const currK8sVersion = cfg.kubernetes.version;
const finalK8sVersion = currK8sVersion.startsWith('v') ? currK8sVersion.substring(1) : currK8sVersion;
const subject = new SettingsValidator();

subject.k8sVersions = [finalK8sVersion, '1.0.0'];
describe(SettingsValidator, () => {
  describe('validateSettings', () => {
    it('should do nothing when given existing settings', () => {
      const [needToUpdate, errors] = subject.validateSettings(cfg, cfg);

      expect(needToUpdate).toBeFalsy();
      expect(errors.length).toEqual(0);
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
      expect(errors.length).toEqual(0);
    });

    it('should report errors for unchangeable fields', () => {
      const desiredEnabled = !cfg.kubernetes.enabled;
      const desiredEngine = cfg.kubernetes.containerEngine === 'moby' ? 'containerd' : 'moby';
      const requestedSettings = {
        kubernetes:
          {
            enabled:                    desiredEnabled,
            containerEngine:            desiredEngine,
            checkForExistingKimBuilder: !cfg.kubernetes.checkForExistingKimBuilder,
          }
      };
      const [needToUpdate, errors] = subject.validateSettings(cfg, requestedSettings);

      expect(needToUpdate).toBeFalsy();
      expect(errors.length).toEqual(1);
      expect(errors).toContain("Changing field kubernetes.checkForExistingKimBuilder via the API isn't supported.");
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
        expect(errors.length).toEqual(1);
        expect(errors[0]).toContain(`Changing field ${ fullQualifiedPreferenceName } via the API isn't supported.`);
      }
    });

    it('should complain about invalid fields', () => {
      let [needToUpdate, errors] = subject.validateSettings(cfg, { kubernetes: { version: '1.1.1' } });

      expect(needToUpdate).toBeFalsy();
      expect(errors.length).toEqual(1);
      expect(errors[0]).toContain('Kubernetes version 1.1.1 not found.');

      [needToUpdate, errors] = subject.validateSettings(cfg, { kubernetes: { containerEngine: '1.1.1' } });
      expect(needToUpdate).toBeFalsy();
      expect(errors.length).toEqual(1);
      expect(errors[0]).toContain("Invalid value for kubernetes.containerEngine: <1.1.1>; must be 'containerd', 'docker', or 'moby'");

      [needToUpdate, errors] = subject.validateSettings(cfg, { kubernetes: { enabled: 1 } });
      expect(needToUpdate).toBeFalsy();
      expect(errors.length).toEqual(1);
      expect(errors[0]).toContain('Invalid value for kubernetes.enabled: <1>');
    });

    it('complains about mismatches between objects and scalars', () => {
      let [needToUpdate, errors] = subject.validateSettings(cfg, { kubernetes: 5 });

      expect(needToUpdate).toBeFalsy();
      expect(errors.length).toEqual(1);
      expect(errors[0]).toContain('Setting kubernetes should wrap an inner object, but got <5>');

      [needToUpdate, errors] = subject.validateSettings(cfg, { kubernetes: { containerEngine: { expected: 'a string' } } });
      expect(needToUpdate).toBeFalsy();
      expect(errors.length).toEqual(1);
      expect(errors[0]).toContain('Setting kubernetes.containerEngine should be a simple value, but got <{"expected":"a string"}>');

      [needToUpdate, errors] = subject.validateSettings(cfg, { kubernetes: { containerEngine: { expected: 'a string' } } });
      expect(needToUpdate).toBeFalsy();
      expect(errors.length).toEqual(1);
      expect(errors[0]).toContain('Setting kubernetes.containerEngine should be a simple value, but got <{"expected":"a string"}>');

      [needToUpdate, errors] = subject.validateSettings(cfg, { kubernetes: { WSLIntegrations: "ceci n'est pas un objet" } });
      expect(needToUpdate).toBeFalsy();
      expect(errors.length).toEqual(1);
      expect(errors[0]).toContain("Proposed field kubernetes.WSLIntegrations should be an object, got <ceci n'est pas un objet>");
    });
  });
});
