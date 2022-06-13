import _ from 'lodash';
import SettingsValidator from '../settingsValidator';
import * as settings from '@/config/settings';
import { PathManagementStrategy } from '@/integrations/pathManager';

const cfg = _.merge(
  {},
  settings.defaultSettings,
  {
    kubernetes:             { version: '1.23.4' },
    pathManagementStrategy: PathManagementStrategy.Manual,
  });

const subject = new SettingsValidator();

subject.k8sVersions = ['1.23.4', '1.0.0'];
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

      checkSetting([], cfg);
    });

    describe('kubernetes.containerEngine', () => {
      function configWithValue(value: string | settings.ContainerEngine): settings.Settings {
        return {
          ...cfg,
          kubernetes: {
            ...cfg.kubernetes,
            containerEngine: value as settings.ContainerEngine,
          },
        };
      }

      describe('should accept valid settings', () => {
        const validKeys = Object.keys(settings.ContainerEngine).filter(x => x !== 'NONE');

        test.each(validKeys)('%s', (key) => {
          const typedKey = key as keyof typeof settings.ContainerEngine;
          const [needToUpdate, errors] = subject.validateSettings(
            configWithValue(settings.ContainerEngine.NONE),
            configWithValue(settings.ContainerEngine[typedKey]),
          );

          expect({ needToUpdate, errors }).toEqual({
            needToUpdate: true,
            errors:       [],
          });
        });
      });

      it('should reject setting to NONE', () => {
        const [needToUpdate, errors] = subject.validateSettings(cfg, { kubernetes: { containerEngine: settings.ContainerEngine.NONE } });

        expect({ needToUpdate, errors }).toEqual({
          needToUpdate: false,
          errors:       [expect.stringContaining('Invalid value for kubernetes.containerEngine: <>;')],
        });
      });

      describe('should accept aliases', () => {
        const aliases = ['docker'];

        it.each(aliases)('%s', (alias) => {
          const [needToUpdate, errors] = subject.validateSettings(
            configWithValue(settings.ContainerEngine.NONE),
            { kubernetes: { containerEngine: alias as settings.ContainerEngine } });

          expect({ needToUpdate, errors }).toEqual({
            needToUpdate: true,
            errors:       [],
          });
        });
      });

      it('should reject invalid values', () => {
        const [needToUpdate, errors] = subject.validateSettings(cfg, { kubernetes: { containerEngine: 'pikachu' as settings.ContainerEngine } });

        expect({ needToUpdate, errors }).toEqual({
          needToUpdate: false,
          errors:       [expect.stringContaining('Invalid value for kubernetes.containerEngine: <pikachu>;')],
        });
      });
    });

    describe('kubernetes.WSLIntegrations', () => {
      // TODO
    });

    describe('kubernetes.version', () => {
      it('should accept a valid version', () => {
        const [needToUpdate, errors] = subject.validateSettings(cfg, { kubernetes: { version: '1.0.0' } });

        expect({ needToUpdate, errors }).toEqual({
          needToUpdate: true,
          errors:       [],
        });
      });

      it('should reject an unknown version', () => {
        const [needToUpdate, errors] = subject.validateSettings(cfg, { kubernetes: { version: '3.2.1' } });

        expect({ needToUpdate, errors }).toEqual({
          needToUpdate: false,
          errors:       [`Kubernetes version "3.2.1" not found.`],
        });
      });

      it('should normalize the version', () => {
        const [needToUpdate, errors] = subject.validateSettings(
          cfg,
          { kubernetes: { version: 'v1.0.0+k3s12345' } });

        expect({ needToUpdate, errors }).toEqual({
          needToUpdate: true,
          errors:       [],
        });
      });

      it('should reject a non-version value', () => {
        const [needToUpdate, errors] = subject.validateSettings(
          cfg,
          { kubernetes: { version: 'pikachu' } });

        expect({ needToUpdate, errors }).toEqual({
          needToUpdate: false,
          errors:       [`Kubernetes version "pikachu" not found.`],
        });
      });
    });

    describe('pathManagementStrategy', () => {
      describe('should accept valid settings', () => {
        const validStrategies = Object.keys(PathManagementStrategy).filter(x => x !== 'NotSet');

        test.each(validStrategies)('%s', (strategy) => {
          const value = PathManagementStrategy[strategy as keyof typeof PathManagementStrategy];
          const [needToUpdate, errors] = subject.validateSettings({
            ...cfg,
            pathManagementStrategy: PathManagementStrategy.NotSet,
          }, { pathManagementStrategy: value });

          expect({ needToUpdate, errors }).toEqual({
            needToUpdate: true,
            errors:       [],
          });
        });
      });

      it('should reject invalid values', () => {
        const [needToUpdate, errors] = subject.validateSettings(cfg, { pathManagementStrategy: 'invalid value' as PathManagementStrategy });

        expect({ needToUpdate, errors }).toEqual({
          needToUpdate: false,
          errors:       [`pathManagementStrategy: "invalid value" is not a valid strategy`],
        });
      });

      it('should reject setting as NotSet', () => {
        const [needToUpdate, errors] = subject.validateSettings(cfg, { pathManagementStrategy: PathManagementStrategy.NotSet });

        expect({ needToUpdate, errors }).toEqual({
          needToUpdate: false,
          errors:       [`pathManagementStrategy: "notset" is not a valid strategy`],
        });
      });
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
  });
});
