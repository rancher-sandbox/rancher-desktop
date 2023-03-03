import os from 'os';

import _ from 'lodash';

import SettingsValidator from '../settingsValidator';

import * as settings from '@pkg/config/settings';
import { LockedSettingsType } from '@pkg/config/settings';
import { PathManagementStrategy } from '@pkg/integrations/pathManager';
import { RecursivePartial } from '@pkg/utils/typeUtils';

const cfg = _.merge(
  {},
  settings.defaultSettings,
  {
    kubernetes:  { version: '1.23.4' },
    application: { pathManagementStrategy: PathManagementStrategy.Manual },
  });

const subject = new SettingsValidator();
let spyPlatform: jest.SpiedFunction<typeof os.platform>;
let lockedSettings: LockedSettingsType|null = null;

beforeEach(() => {
  spyPlatform = jest.spyOn(os, 'platform');
  lockedSettings = null;
});

afterEach(() => {
  spyPlatform.mockRestore();
});

subject.k8sVersions = ['1.23.4', '1.0.0'];
describe(SettingsValidator, () => {
  it('should do nothing when given existing settings', () => {
    const [needToUpdate, errors] = subject.validateSettings(cfg, cfg, lockedSettings);

    expect({ needToUpdate, errors }).toEqual({
      needToUpdate: false,
      errors:       [],
    });
  });

  it('should want to apply changes when valid new settings are proposed', () => {
    const newEnabled = !cfg.kubernetes.enabled;
    const newVersion = subject.k8sVersions[1];
    const newEngine = cfg.containerEngine.name === 'moby' ? 'containerd' : 'moby';
    const newFlannelEnabled = !cfg.kubernetes.options.flannel;
    const newConfig = _.merge({}, cfg, {
      containerEngine: { name: newEngine },
      kubernetes:
        {
          enabled: newEnabled,
          version: newVersion,
          options: { flannel: newFlannelEnabled },
        },
    });
    const [needToUpdate, errors] = subject.validateSettings(cfg, newConfig, lockedSettings);

    expect({ needToUpdate, errors }).toEqual({
      needToUpdate: true,
      errors:       [],
    });
  });

  describe('all standard fields', () => {
    // Special fields that cannot be checked here; this includes enums and maps.
    const specialFields = [
      ['application', 'pathManagementStrategy'],
      ['containerEngine', 'allowedImages', 'locked'],
      ['containerEngine', 'name'],
      ['experimental', 'virtualMachine', 'mount', '9p', 'cacheMode'],
      ['experimental', 'virtualMachine', 'mount', '9p', 'msizeInKB'],
      ['experimental', 'virtualMachine', 'mount', '9p', 'protocolVersion'],
      ['experimental', 'virtualMachine', 'mount', '9p', 'securityModel'],
      ['experimental', 'virtualMachine', 'mount', 'type'],
      ['kubernetes', 'version'],
      ['version'],
      ['WSL', 'integrations'],
    ];

    // Fields that can only be set on specific platforms.
    const platformSpecificFields: Record<string, ReturnType<typeof os.platform>> = {
      'application.adminAccess':                      'linux',
      'experimental.virtualMachine.socketVMNet':      'darwin',
      'experimental.virtualMachine.networkingTunnel': 'win32',
      'virtualMachine.hostResolver':                  'win32',
      'virtualMachine.memoryInGB':                    'darwin',
      'virtualMachine.numberCPUs':                    'linux',
    };

    const spyValidateSettings = jest.spyOn(subject, 'validateSettings');

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

        if (keyPath.join('.') in platformSpecificFields) {
          beforeEach(() => {
            spyPlatform.mockReturnValue(platformSpecificFields[keyPath.join('.')]);
          });
        }

        it('should allow no change', () => {
          const input = _.set({}, keyPath, _.get(cfg, keyPath));
          const [needToUpdate, errors] = subject.validateSettings(cfg, input, lockedSettings);

          expect({ needToUpdate, errors }).toEqual({
            needToUpdate: false,
            errors:       [],
          });
        });

        if (specialFields.some(specialField => _.isEqual(path.concat(key), specialField))) {
          return;
        }

        it('should allow changing', () => {
          let newValue: any;

          switch (typeof defaultSettings[key]) {
          case 'boolean':
            newValue = !defaultSettings[key];
            break;
          case 'number':
            newValue = defaultSettings[key] + 1;
            break;
          case 'string':
            newValue = `${ defaultSettings[key] }!`;
            break;
          default:
            expect(['boolean', 'number', 'string']).toContain(typeof defaultSettings[key]);
          }

          const input = _.set({}, keyPath, newValue);
          const [needToUpdate, errors] = subject.validateSettings(cfg, input, lockedSettings);

          expect({ needToUpdate, errors }).toEqual({
            needToUpdate: true,
            errors:       [],
          });
        });

        it('should disallow invalid values', () => {
          let invalidValue: any;

          if (typeof defaultSettings[key] !== 'string') {
            invalidValue = 'invalid value';
          } else {
            invalidValue = 3;
          }

          const input = _.set({}, keyPath, invalidValue);
          const [needToUpdate, errors] = subject.validateSettings(cfg, input, lockedSettings);

          expect({ needToUpdate, errors }).toEqual({
            needToUpdate: false,
            errors:       [`Invalid value for ${ prefix }${ key }: <${ JSON.stringify(invalidValue) }>`],
          });
        });

        if (typeof defaultSettings[key] === 'boolean') {
          it('should accept string true', () => {
            const orig = _.merge({}, cfg, _.set({}, keyPath, false));
            const [needToUpdate, errors] = subject.validateSettings(orig, _.set({}, keyPath, 'true'), lockedSettings);

            expect({ needToUpdate, errors }).toEqual({
              needToUpdate: true,
              errors:       [],
            });
          });
          it('should accept string false', () => {
            const orig = _.merge({}, cfg, _.set({}, keyPath, true));
            const [needToUpdate, errors] = subject.validateSettings(orig, _.set({}, keyPath, 'false'), lockedSettings);

            expect({ needToUpdate, errors }).toEqual({
              needToUpdate: true,
              errors:       [],
            });
          });
        }
      });
    }

    checkSetting([], cfg);

    it('should have validated at least one setting', () => {
      expect(spyValidateSettings).toHaveBeenCalled();
    });
  });

  describe('containerEngine.name', () => {
    function configWithValue(value: string | settings.ContainerEngine): settings.Settings {
      return {
        ...cfg,
        containerEngine: {
          ...cfg.containerEngine,
          name: value as settings.ContainerEngine,
        },
      };
    }

    describe('should accept valid settings', () => {
      const validKeys = Object.keys(settings.ContainerEngine).filter(x => x !== 'NONE');

      test.each(validKeys)('%s', (key) => {
        const typedKey = key as keyof typeof settings.ContainerEngine;
        const [needToUpdate, errors] = subject.validateSettings(
          configWithValue(settings.ContainerEngine.NONE),
          { containerEngine: { name: settings.ContainerEngine[typedKey] } },
          lockedSettings,
        );

        expect({ needToUpdate, errors }).toEqual({
          needToUpdate: true,
          errors:       [],
        });
      });
    });

    it('should reject setting to NONE', () => {
      const [needToUpdate, errors] = subject.validateSettings(cfg, { containerEngine: { name: settings.ContainerEngine.NONE } }, lockedSettings);

      expect({ needToUpdate, errors }).toEqual({
        needToUpdate: false,
        errors:       [expect.stringContaining('Invalid value for containerEngine.name: <"">;')],
      });
    });

    describe('should accept aliases', () => {
      const aliases = ['docker'];

      it.each(aliases)('%s', (alias) => {
        const [needToUpdate, errors] = subject.validateSettings(
          configWithValue(settings.ContainerEngine.NONE),
          { containerEngine: { name: alias as settings.ContainerEngine } },
          lockedSettings,
        );

        expect({ needToUpdate, errors }).toEqual({
          needToUpdate: true,
          errors:       [],
        });
      });
    });

    it('should reject invalid values', () => {
      const [needToUpdate, errors] = subject.validateSettings(
        cfg,
        { containerEngine: { name: 'pikachu' as settings.ContainerEngine } },
        lockedSettings,
      );

      expect({ needToUpdate, errors }).toEqual({
        needToUpdate: false,
        errors:       [expect.stringContaining('Invalid value for containerEngine.name: <"pikachu">; must be one of ["containerd","moby","docker"]')],
      });
    });
  });

  describe('WSL.integrations', () => {
    beforeEach(() => {
      spyPlatform.mockReturnValue('win32');
    });

    it('should reject invalid values', () => {
      const [needToUpdate, errors] = subject.validateSettings(cfg, { WSL: { integrations: 3 as unknown as Record<string, boolean> } }, lockedSettings);

      expect({ needToUpdate, errors }).toEqual({
        needToUpdate: false,
        errors:       ['Proposed field WSL.integrations should be an object, got <3>.'],
      });
    });

    it('should reject being set on non-Windows', () => {
      spyPlatform.mockReturnValue('haiku');
      const [needToUpdate, errors] = subject.validateSettings(cfg, { WSL: { integrations: { foo: true } } }, lockedSettings);

      expect({ needToUpdate, errors }).toEqual({
        needToUpdate: false,
        errors:       ["Changing field WSL.integrations via the API isn't supported."],
      });
    });

    it('should reject invalid configuration', () => {
      const [needToUpdate, errors] = subject.validateSettings(cfg, { WSL: { integrations: { distribution: 3 as unknown as boolean } } }, lockedSettings);

      expect({ needToUpdate, errors }).toEqual({
        needToUpdate: false,
        errors:       ['Invalid value for WSL.integrations.distribution: <3>'],
      });
    });

    it('should allow being changed', () => {
      const [needToUpdate, errors] = subject.validateSettings({
        ...cfg,
        WSL: { integrations: { distribution: false } },
      }, { WSL: { integrations: { distribution: true } } }, lockedSettings);

      expect({ needToUpdate, errors }).toEqual({
        needToUpdate: true,
        errors:       [],
      });
    });
  });

  describe('kubernetes.version', () => {
    it('should accept a valid version', () => {
      const [needToUpdate, errors] = subject.validateSettings(cfg, { kubernetes: { version: '1.0.0' } }, lockedSettings);

      expect({ needToUpdate, errors }).toEqual({
        needToUpdate: true,
        errors:       [],
      });
    });

    it('should reject an unknown version', () => {
      const [needToUpdate, errors] = subject.validateSettings(cfg, {
        kubernetes: {
          version: '3.2.1',
          enabled: true,
        },
      }, lockedSettings);

      expect({ needToUpdate, errors }).toEqual({
        needToUpdate: false,
        errors:       [`Kubernetes version "3.2.1" not found.`],
      });
    });

    it('should normalize the version', () => {
      const [needToUpdate, errors] = subject.validateSettings(
        cfg,
        { kubernetes: { version: 'v1.0.0+k3s12345' } }, lockedSettings);

      expect({ needToUpdate, errors }).toEqual({
        needToUpdate: true,
        errors:       [],
      });
    });

    it('should reject a non-version value', () => {
      const [needToUpdate, errors] = subject.validateSettings(
        cfg,
        {
          kubernetes: {
            version: 'pikachu',
            enabled: true,
          },
        }, lockedSettings);

      expect({ needToUpdate, errors }).toEqual({
        needToUpdate: false,
        errors:       [`Kubernetes version "pikachu" not found.`],
      });
    });
  });

  describe('pathManagementStrategy', () => {
    beforeEach(() => {
      spyPlatform.mockReturnValue('linux');
    });
    describe('should accept valid settings', () => {
      const validStrategies = Object.keys(PathManagementStrategy).filter(x => x !== 'NotSet');

      test.each(validStrategies)('%s', (strategy) => {
        const value = PathManagementStrategy[strategy as keyof typeof PathManagementStrategy];
        const [needToUpdate, errors] = subject.validateSettings({
          ...cfg,
          application: {
            ...cfg.application,
            pathManagementStrategy: PathManagementStrategy.NotSet,
          },
        }, { application: { pathManagementStrategy: value } }, lockedSettings);

        expect({ needToUpdate, errors }).toEqual({
          needToUpdate: true,
          errors:       [],
        });
      });
    });

    it('should reject invalid values', () => {
      const [needToUpdate, errors] = subject.validateSettings(cfg,
        { application: { pathManagementStrategy: 'invalid value' as PathManagementStrategy } }, lockedSettings);

      expect({ needToUpdate, errors }).toEqual({
        needToUpdate: false,
        errors:       [`application.pathManagementStrategy: "invalid value" is not a valid strategy`],
      });
    });

    it('should reject setting as NotSet', () => {
      const [needToUpdate, errors] = subject.validateSettings(cfg,
        { application: { pathManagementStrategy: PathManagementStrategy.NotSet } }, lockedSettings);

      expect({ needToUpdate, errors }).toEqual({
        needToUpdate: false,
        errors:       [`application.pathManagementStrategy: "notset" is not a valid strategy`],
      });
    });
  });

  describe('containerEngine.allowedImages', () => {
    const allowedImageListConfig: settings.Settings = _.merge({}, cfg, {
      containerEngine: {
        allowedImages: {
          enabled:  false,
          patterns: ['morisot', 'cassatt', 'kahlo'],
        },
      },
    });

    describe('when a field is locked', () => {
      it("locked allowedImages:enabled-field can't be changed", () => {
        const lockedSettings = { containerEngine: { allowedImages: { enabled: true } } };
        const input: RecursivePartial<settings.Settings> = { containerEngine: { allowedImages: { enabled: true } } };
        const [needToUpdate, errors] = subject.validateSettings(allowedImageListConfig, input, lockedSettings);

        expect({ needToUpdate, errors }).toEqual({
          needToUpdate: false,
          errors:       ["field 'containerEngine.allowedImages.enabled' is locked"],
        });
      });
      it('locked allowedImages:enabled-field can be set to the same value', () => {
        const lockedSettings = { containerEngine: { allowedImages: { enabled: true } } };
        const currentEnabled = allowedImageListConfig.containerEngine.allowedImages.enabled;
        const input: RecursivePartial<settings.Settings> = { containerEngine: { allowedImages: { enabled: currentEnabled } } };
        const [needToUpdate, errors] = subject.validateSettings(allowedImageListConfig, input, lockedSettings);

        expect({ needToUpdate, errors }).toEqual({
          needToUpdate: false,
          errors:       [],
        });
      });

      it("locked allowedImages:patterns-field can't be changed by adding a pattern", () => {
        const lockedSettings = { containerEngine: { allowedImages: { patterns: true } } };
        const input: RecursivePartial<settings.Settings> = {
          containerEngine: {
            allowedImages: { // eslint-disable object-curly-newline
              patterns: allowedImageListConfig.containerEngine.allowedImages.patterns.concat('pattern3'),
            },
          },
        };
        const [needToUpdate, errors] = subject.validateSettings(allowedImageListConfig, input, lockedSettings);

        expect({ needToUpdate, errors }).toEqual({
          needToUpdate: false,
          errors:       ["field 'containerEngine.allowedImages.patterns' is locked"],
        });
      });

      it("locked allowedImages:patterns-field can't be changed by removing a pattern", () => {
        const lockedSettings = { containerEngine: { allowedImages: { patterns: true } } };
        const input: RecursivePartial<settings.Settings> = {
          containerEngine: {
            allowedImages: { // eslint-disable object-curly-newline
              patterns: allowedImageListConfig.containerEngine.allowedImages.patterns.slice(1),
            },
          },
        };
        const [needToUpdate, errors] = subject.validateSettings(allowedImageListConfig, input, lockedSettings);

        expect({ needToUpdate, errors }).toEqual({
          needToUpdate: false,
          errors:       ["field 'containerEngine.allowedImages.patterns' is locked"],
        });
      });

      it("locked allowedImages:patterns-field can't be changed by removing a pattern", () => {
        let input = { containerEngine: { allowedImages: { patterns: ['pattern1'] } } };
        let [needToUpdate, errors] = subject.validateSettings(allowedImageListConfig, input, lockedSettings);

        expect({ needToUpdate, errors }).toEqual({
          needToUpdate: true,
          errors:       [],
        });
        input = { containerEngine: { allowedImages: { patterns: ['pattern1', 'pattern2', 'pattern3'] } } };
        ([needToUpdate, errors] = subject.validateSettings(allowedImageListConfig, input, lockedSettings));

        expect({ needToUpdate, errors }).toEqual({
          needToUpdate: true,
          errors:       [],
        });
      });
    });
    it('locked allowedImages:patterns-field can be set to the same value', () => {
      const lockedSettings = { containerEngine: { allowedImages: { patterns: true } } };
      const input: RecursivePartial<settings.Settings> = { containerEngine: { allowedImages: { patterns: allowedImageListConfig.containerEngine.allowedImages.patterns } } };
      const [needToUpdate, errors] = subject.validateSettings(allowedImageListConfig, input, lockedSettings);

      expect({ needToUpdate, errors }).toEqual({
        needToUpdate: false,
        errors:       [],
      });
    });
  });

  describe('checking locks', () => {
    const ceSettings: RecursivePartial<settings.Settings> = {
      containerEngine: {
        allowedImages: {
          enabled:  false,
          patterns: ['pattern1', 'pattern2'],
        },
      },
    };
    const allowedImageListConfig: settings.Settings = _.merge({}, cfg, ceSettings);

    describe('when unlocked', () => {
      it('allows changes', () => {
        const lockedSettings = { containerEngine: { allowedImages: { patterns: false } } };
        let input: RecursivePartial<settings.Settings> = { containerEngine: { allowedImages: { enabled: true } } };
        let [needToUpdate, errors] = subject.validateSettings(allowedImageListConfig, input, lockedSettings);

        expect({ needToUpdate, errors }).toEqual({ needToUpdate: true, errors: [] });

        input = { containerEngine: { allowedImages: { patterns: ['pattern1'] } } };
        ([needToUpdate, errors] = subject.validateSettings(allowedImageListConfig, input, lockedSettings));

        expect({ needToUpdate, errors }).toEqual({
          needToUpdate: true,
          errors:       [],
        });
        input = { containerEngine: { allowedImages: { patterns: ['pattern1', 'pattern2', 'pattern3'] } } };
        ([needToUpdate, errors] = subject.validateSettings(allowedImageListConfig, input, lockedSettings));

        expect({ needToUpdate, errors }).toEqual({
          needToUpdate: true,
          errors:       [],
        });
      });
    });

    describe('when locked', () => {
      const lockedSettings = {
        containerEngine: {
          allowedImages: {
            enabled:  true,
            patterns: true,
          },
        },
      };

      it('disallows changes', () => {
        const currentEnabled = allowedImageListConfig.containerEngine.allowedImages.enabled;
        const currentPatterns = allowedImageListConfig.containerEngine.allowedImages.patterns;
        let input: RecursivePartial<settings.Settings> = { containerEngine: { allowedImages: { enabled: !currentEnabled } } };
        let [needToUpdate, errors] = subject.validateSettings(allowedImageListConfig, input, lockedSettings);

        expect({ needToUpdate, errors }).toEqual({
          needToUpdate: false,
          errors:       ["field 'containerEngine.allowedImages.enabled' is locked"],
        });

        input = { containerEngine: { allowedImages: { patterns: ['picasso'].concat(currentPatterns) } } };
        ([needToUpdate, errors] = subject.validateSettings(allowedImageListConfig, input, lockedSettings));
        expect({ needToUpdate, errors }).toEqual({
          needToUpdate: false,
          errors:       ["field 'containerEngine.allowedImages.patterns' is locked"],
        });

        input = { containerEngine: { allowedImages: { patterns: currentPatterns.slice(1) } } };
        ([needToUpdate, errors] = subject.validateSettings(allowedImageListConfig, input, lockedSettings));

        expect({ needToUpdate, errors }).toEqual({
          needToUpdate: false,
          errors:       ["field 'containerEngine.allowedImages.patterns' is locked"],
        });
      });

      it("doesn't complain when no locked fields change", () => {
        const [needToUpdate, errors] = subject.validateSettings(allowedImageListConfig, ceSettings, lockedSettings);

        expect({ needToUpdate, errors }).toEqual({
          needToUpdate: false,
          errors:       [],
        });
      });
    });
  });

  it('should complain about unchangeable fields', () => {
    const unchangeableFieldsAndValues = { version: -1 };

    // Check that we _don't_ ask for update when we have errors.
    const input = { application: { telemetry: { enabled: !cfg.application.telemetry.enabled } } };

    for (const [path, value] of Object.entries(unchangeableFieldsAndValues)) {
      _.set(input, path, value);
    }

    const [needToUpdate, errors] = subject.validateSettings(cfg, input, lockedSettings);

    expect({ needToUpdate, errors }).toEqual({
      needToUpdate: false,
      errors:       Object.keys(unchangeableFieldsAndValues).map(key => `Changing field ${ key } via the API isn't supported.`),
    });
  });

  it('complains about mismatches between objects and scalars', () => {
    let [needToUpdate, errors] = subject.validateSettings(cfg, { kubernetes: 5 as unknown as Record<string, number> }, lockedSettings);

    expect(needToUpdate).toBeFalsy();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Setting kubernetes should wrap an inner object, but got <5>');

    [needToUpdate, errors] = subject.validateSettings(cfg, {
      containerEngine: { name: { expected: 'a string' } as unknown as settings.ContainerEngine },
      kubernetes:      {
        version: { expected: 'a string' } as unknown as string,
        options: "ceci n'est pas un objet" as unknown as Record<string, boolean>,
        enabled: true,
      },
    }, lockedSettings);
    expect(needToUpdate).toBeFalsy();
    expect(errors).toHaveLength(3);
    expect(errors).toEqual([
      `Invalid value for containerEngine.name: <{"expected":"a string"}>; must be one of ["containerd","moby","docker"]`,
      'Kubernetes version "[object Object]" not found.',
      "Setting kubernetes.options should wrap an inner object, but got <ceci n'est pas un objet>.",
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
        },
        enabled: true,
      },
      portForwarding: {
        'kiwano // 8 1/2':         'cows',
        includeKubernetesServices: cfg.portForwarding.includeKubernetesServices,
      },
      'feijoa - Alps': [],
    } as unknown as settings.Settings,
    lockedSettings);

    expect({ needToUpdate, errors }).toEqual({
      needToUpdate: false,
      errors:       expect.objectContaining({ length: 1 }),
    });
  });

  it('should allow empty Kubernetes version when Kubernetes is disabled', () => {
    const [needToUpdate, errors] = subject.validateSettings(
      cfg,
      {
        kubernetes: {
          version: '',
          enabled: false,
        },
      }, lockedSettings);

    expect(needToUpdate).toBeTruthy();
    expect(errors).toHaveLength(0);
    expect(errors).toEqual([]);
  });

  it('should disallow empty Kubernetes version when Kubernetes is enabled', () => {
    const [needToUpdate, errors] = subject.validateSettings(
      cfg,
      {
        kubernetes: {
          version: '',
          enabled: true,
        },
      }, lockedSettings);

    expect(needToUpdate).toBeFalsy();
    expect(errors).toHaveLength(1);
    expect(errors).toEqual([
      'Kubernetes version "" not found.',
    ]);
  });
});
