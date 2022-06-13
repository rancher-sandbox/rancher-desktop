import _ from 'lodash';
import SettingsValidator from '../settingsValidator';
import * as settings from '@/config/settings';
import { RecursivePartial } from '@/utils/typeUtils';

const cfg = settings.load();

cfg.kubernetes.version = '1.23.4';
const currK8sVersion = cfg.kubernetes.version;
const finalK8sVersion = currK8sVersion.replace(/^v?/, '');
const subject = new SettingsValidator();

subject.k8sVersions = [finalK8sVersion, '1.0.0'];
describe(SettingsValidator, () => {
  describe('canonicalizeSynonyms', () => {
    it('should modify valid values that are synonyms for canonical forms', () => {
      const desiredEnabledString = cfg.kubernetes.enabled ? 'false' : 'true';
      const desiredEnabledBoolean = !cfg.kubernetes.enabled;
      const newFlannelEnabled = !cfg.kubernetes.options.flannel;
      const newConfig: Record<string, any> = _.merge({}, cfg, {
        kubernetes:
        {
          enabled:         desiredEnabledString, // force a change
          version:         'v1.23.4+k3s1',
          containerEngine: 'docker',
          options:         { flannel: newFlannelEnabled },
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
  });

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
      const newFlannelEnabled = !cfg.kubernetes.options.flannel;
      const newConfig = _.merge({}, cfg, {
        kubernetes:
          {
            enabled:         newEnabled,
            version:         newVersion,
            containerEngine: newEngine,
            options:         { flannel: newFlannelEnabled },
          }
      });
      const [needToUpdate, errors] = subject.validateSettings(cfg, newConfig);

      expect(needToUpdate).toBeTruthy();
      expect(errors).toHaveLength(0);
    });

    describe('all standard fields', () => {
      // Special fields that cannot be checked here; this includes enums and maps.
      const specialFields = [
        ['kubernetes', 'checkForExistingKimBuilder'],
        ['kubernetes', 'containerEngine'],
        ['kubernetes', 'WSLIntegrations'],
        ['kubernetes', 'version'],
        ['pathManagementStrategy'],
        ['version'],
      ];

      function checkSetting(path: string[], defaultSettings: any) {
        const prefix = path.length === 0 ? '' : `${ path.join('.') }.`;
        const props = [];

        if (specialFields.some(specialField => _.isEqual(path, specialField))) {
          return;
        }

        for (const key of Object.keys(defaultSettings)) {
          if (typeof defaultSettings[key] === 'object') {
            checkSetting(path.concat(key), defaultSettings[key]);
          } else {
            if (specialFields.some(specialField => _.isEqual(path.concat(key), specialField))) {
              continue;
            }
            props.push(key);
          }
        }

        if (props.length === 0) {
          return;
        }

        describe.each(props.sort())(`${ prefix }%s`, (key) => {
          const keyPath = path.concat(key);

          if (!specialFields.some(specialField => _.isEqual(path.concat(key), specialField))) {
            it('should allow changing', () => {
              let newValue: any;

              switch (typeof defaultSettings[key]) {
              case 'boolean':
                newValue = !_.get(cfg, keyPath);
                break;
              case 'number':
                newValue = _.get(cfg, keyPath) + 1;
                break;
              case 'string':
                newValue = `${ _.get(cfg, keyPath) }!`;
                break;
              default:
                expect(['boolean', 'number', 'string']).toContain(typeof defaultSettings[key]);
              }

              const input = _.set({}, keyPath, newValue);
              const [needToUpdate, errors] = subject.validateSettings(cfg, input);

              expect({ needToUpdate, errors }).toEqual({
                needToUpdate: true,
                errors:       [],
              });
            });
          }

          it('should allow no change', () => {
            const input = _.set({}, keyPath, _.get(cfg, keyPath));
            const [needToUpdate, errors] = subject.validateSettings(cfg, input);

            expect({ needToUpdate, errors }).toEqual({
              needToUpdate: false,
              errors:       [],
            });
          });

          if (!specialFields.some(specialField => _.isEqual(path.concat(key), specialField))) {
            it('should disallow invalid values', () => {
              let invalidValue: any;

              if (typeof defaultSettings[key] !== 'string') {
                invalidValue = 'invalid value';
              } else {
                invalidValue = 3;
              }
              const input = _.set({}, keyPath, invalidValue);

              const [needToUpdate, errors] = subject.validateSettings(cfg, input);

              expect({ needToUpdate, errors }).toEqual({
                needToUpdate: false,
                errors:       [`Invalid value for ${ prefix }${ key }: <${ invalidValue }>`],
              });
            });
          }
        });
      }

      checkSetting([], settings.defaultSettings);
    });

    describe('kubernetes.WSLIntegrations', () => {
      // TODO
    });

    it('should canonicalize and accept near-valid values', () => {
      const newConfig = _.merge({}, cfg, {
        kubernetes:
        {
          enabled:         cfg.kubernetes.enabled ? 'false' : 'true', // force a change
          version:         'v1.23.4+k3s1',
          containerEngine: 'docker',
          options:         { flannel: cfg.kubernetes.options.flannel ? 'false' : 'true' },
        }
      });
      const [needToUpdate, errors] = subject.validateSettings(cfg, newConfig);

      expect(errors).toHaveLength(0);
      expect(needToUpdate).toBeTruthy();
    });

    it('should complain about unchangeable fields', () => {
      const unchanableFieldsAndValues = {
        'kubernetes.checkForExistingKimBuilder': !cfg.kubernetes.checkForExistingKimBuilder,
        version:                                 -1
      };

      // Check that we _don't_ ask for update when we  have errors.
      const input = { telemetry: !cfg.telemetry };

      for (const [path, value] of Object.entries(unchanableFieldsAndValues)) {
        _.set(input, path, value);
      }

      const [needToUpdate, errors] = subject.validateSettings(cfg, input);

      expect({ needToUpdate, errors }).toEqual({
        needToUpdate: false,
        errors:       Object.keys(unchanableFieldsAndValues).map(key => `Changing field ${ key } via the API isn't supported.`),
      });
    });

    it('should complain about invalid fields', () => {
      const [needToUpdate, errors] = subject.validateSettings(cfg, {
        kubernetes: {
          version:         '1.1.1',
          containerEngine: '1.1.2' as settings.ContainerEngine,
        }
      });

      expect(needToUpdate).toBeFalsy();
      expect(errors).toEqual([
        'Kubernetes version "1.1.1" not found.',
        "Invalid value for kubernetes.containerEngine: <1.1.2>; must be 'containerd', 'docker', or 'moby'",
      ]);
    });

    it('complains about mismatches between objects and scalars', () => {
      let [needToUpdate, errors] = subject.validateSettings(cfg, { kubernetes: 5 as unknown as Record<string, number> });

      expect(needToUpdate).toBeFalsy();
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Setting kubernetes should wrap an inner object, but got <5>');

      [needToUpdate, errors] = subject.validateSettings(cfg, {
        kubernetes: {
          containerEngine: { expected: 'a string' } as unknown as settings.ContainerEngine,
          version:         { expected: 'a string' } as unknown as string,
          WSLIntegrations: "ceci n'est pas un objet" as unknown as Record<string, boolean>,
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
      } as unknown as settings.Settings);

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
      const newStrategy = cfg.pathManagementStrategy === 'manual' ? 'rcfiles' : 'manual';
      const newConfig = _.merge({}, cfg, { pathManagementStrategy: newStrategy });
      const [needToUpdate, errors] = subject.validateSettings(cfg, newConfig);

      expect(needToUpdate).toBeTruthy();
      expect(errors).toHaveLength(0);
    });
  });
});
