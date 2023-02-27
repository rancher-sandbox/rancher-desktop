import fs from 'fs';
import os from 'os';

import _ from 'lodash';

import { LockedFieldError, updateFromCommandLine } from '@pkg/config/commandLineOptions';
import * as settings from '@pkg/config/settings';
import { CacheMode, MountType, ProtocolVersion, SecurityModel } from '@pkg/config/settings';
import { TransientSettings } from '@pkg/config/transientSettings';
import { PathManagementStrategy } from '@pkg/integrations/pathManager';
import clone from '@pkg/utils/clone';

describe('updateFromCommandLine', () => {
  let prefs: settings.Settings;
  let origPrefs: settings.Settings;
  let lockedSettings: settings.LockedSettingsType = {};

  beforeEach(() => {
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => { });
    prefs = {
      version:     6,
      application: {
        adminAccess:            true,
        debug:                  true,
        pathManagementStrategy: PathManagementStrategy.NotSet,
        telemetry:              { enabled: true },
        /** Whether we should check for updates and apply them. */
        updater:                { enabled: true },
        autoStart:              false,
        startInBackground:      false,
        hideNotificationIcon:   false,
        window:                 { quitOnClose: false },
      },
      containerEngine: {
        allowedImages: {
          enabled:  false,
          patterns: [],
        },
        name: settings.ContainerEngine.MOBY,
      },
      virtualMachine: {
        memoryInGB:   4,
        numberCPUs:   2,
        hostResolver: true,
      },
      WSL:        { integrations: {} },
      kubernetes: {
        version: '1.23.5',
        port:    6443,
        enabled: true,
        options: {
          traefik: true,
          flannel: false,
        },
      },
      portForwarding: { includeKubernetesServices: false },
      images:         {
        showAll:   true,
        namespace: 'k8s.io',
      },
      diagnostics: {
        showMuted:   false,
        mutedChecks: { },
      },
      experimental: {
        virtualMachine: {
          socketVMNet: true,
          mount:       {
            type: MountType.REVERSE_SSHFS,
            '9p': {
              securityModel:   SecurityModel.NONE,
              protocolVersion: ProtocolVersion.NINEP2000_L,
              msizeInKB:       128,
              cacheMode:       CacheMode.MMAP,
            },
          },
          networkingTunnel: false,
        },
      },
    };
    origPrefs = clone(prefs);
    lockedSettings = { };
  });

  describe('updateFromCommandLine', () => {
    describe('with locked fields', () => {
      let enabledOptionChange: string;
      let enabledOptionSame: string;
      let lockedFields: settings.LockedSettingsType;

      beforeEach(() => {
        lockedFields = { containerEngine: { allowedImages: { enabled: true } } };
        enabledOptionChange = `--containerEngine.allowedImages.enabled=${ !prefs.containerEngine.allowedImages.enabled }`;
        enabledOptionSame = `--containerEngine.allowedImages.enabled=${ prefs.containerEngine.allowedImages.enabled }`;
      });

      test('disallows changing allowedImages.enabled when locked', () => {
        expect(() => {
          updateFromCommandLine(prefs, lockedFields, [enabledOptionChange]);
        }).toThrow(LockedFieldError);
      });

      test("doesn't complain when not changing fields", () => {
        expect(() => {
          updateFromCommandLine(prefs, lockedFields, [enabledOptionSame]);
        }).not.toThrow();
      });
    });
  });

  test('no command-line args should leave prefs unchanged', () => {
    const newPrefs = updateFromCommandLine(prefs, lockedSettings, []);

    expect(newPrefs).toEqual(origPrefs);
  });

  test('one option with embedded equal sign should change only one value', () => {
    const newPrefs = updateFromCommandLine(prefs, lockedSettings, ['--kubernetes.version=1.23.6']);

    expect(newPrefs.kubernetes.version).toBe('1.23.6');
    newPrefs.kubernetes.version = origPrefs.kubernetes.version;
    expect(newPrefs).toEqual(origPrefs);
  });

  test('one option over two args should change only one value', () => {
    const newPrefs = updateFromCommandLine(prefs, lockedSettings, ['--kubernetes.version', '1.23.7']);

    expect(newPrefs.kubernetes.version).toBe('1.23.7');
    newPrefs.kubernetes.version = origPrefs.kubernetes.version;
    expect(newPrefs).toEqual(origPrefs);
  });

  test('boolean option to true should change only that value', () => {
    const newPrefs = updateFromCommandLine(prefs, lockedSettings, ['--kubernetes.options.flannel=true']);

    expect(origPrefs.kubernetes.options.flannel).toBeFalsy();
    expect(newPrefs.kubernetes.options.flannel).toBeTruthy();
    newPrefs.kubernetes.options.flannel = false;
    expect(newPrefs).toEqual(origPrefs);
  });

  test('boolean option set to implicit true should change only that value', () => {
    const newPrefs = updateFromCommandLine(prefs, lockedSettings, ['--kubernetes.options.flannel']);

    expect(origPrefs.kubernetes.options.flannel).toBeFalsy();
    expect(newPrefs.kubernetes.options.flannel).toBeTruthy();
    newPrefs.kubernetes.options.flannel = false;
    expect(newPrefs).toEqual(origPrefs);
  });

  test('boolean option set to false should change only that value', () => {
    const newPrefs = updateFromCommandLine(prefs, lockedSettings, ['--kubernetes.options.traefik=false']);

    expect(origPrefs.kubernetes.options.traefik).toBeTruthy();
    expect(newPrefs.kubernetes.options.traefik).toBeFalsy();
    newPrefs.kubernetes.options.traefik = true;
    expect(newPrefs).toEqual(origPrefs);
  });

  test('changes specified options', () => {
    const optionsByPlatform: Record<string, Array<string | [string, string]>> = {
      win32: [
        '--virtualMachine.hostResolver',
      ],
      '!win32': [
        '--application.adminAccess',
        ['--application.pathManagementStrategy', 'rcfiles'],
        '--virtualMachine.memoryInGB',
        '--virtualMachine.numberCPUs',
      ],
      darwin: [
        '--experimental.virtualMachine.socketVMNet',
      ],
      '*': [
        '--application.debug',
        '--application.telemetry.enabled',
        '--application.updater.enabled',
        '--application.autoStart',
        '--application.startInBackground',
        '--application.hideNotificationIcon',
        '--application.window.quitOnClose',
        '--containerEngine.allowedImages.enabled',
        ['--containerEngine.name', 'containerd'],
        '--kubernetes.port',
        '--kubernetes.enabled',
        '--kubernetes.options.traefik',
        '--kubernetes.options.flannel',
        '--portForwarding.includeKubernetesServices',
        '--images.showAll',
        ['--images.namespace', 'mangos'],
        '--diagnostics.showMuted',
      ],
    };

    for (const platform in optionsByPlatform) {
      const options: Array<string | [string, string]> = optionsByPlatform[platform as 'win32'|'linux'|'darwin'|'*'];

      for (const entry of options) {
        let option: string;
        let newValue: string|boolean|number|undefined;

        if (Array.isArray(entry)) {
          option = entry[0];
          newValue = entry[1];
        } else {
          option = entry;
        }
        const accessor = option.substring(2);
        const oldValue: string|boolean|number|undefined = _.get(origPrefs, accessor);

        if (oldValue === undefined) {
          console.log('stop here');
        }
        expect(oldValue).not.toBeUndefined();
        if (newValue === undefined) {
          expect(['boolean', 'number']).toContain(typeof oldValue);
          switch (typeof oldValue) {
          case 'boolean':
            newValue = !oldValue;
            break;
          case 'number':
            newValue = oldValue + 1;
            break;
          }
        }
        const newOption = `${ option }=${ newValue }`;

        if (platform !== '*' &&
            ((platform === '!win32' && os.platform() === 'win32') ||
             (platform !== '!win32' && platform !== os.platform()))) {
          expect(() => {
            updateFromCommandLine(prefs, lockedSettings, [newOption]);
          }).toThrow(`Changing field ${ accessor } via the API isn't supported`);
        } else {
          const newPrefs = updateFromCommandLine(prefs, lockedSettings, [newOption]);

          expect(_.get(newPrefs, accessor)).toEqual(newValue);
          _.set(newPrefs, accessor, oldValue);
          expect(newPrefs).toEqual(origPrefs);
        }
      }
    }
  });

  test('nothing after an = should set target to empty string', () => {
    const newPrefs = updateFromCommandLine(prefs, lockedSettings, ['--images.namespace=']);

    expect(origPrefs.images.namespace).not.toBe('');
    expect(newPrefs.images.namespace).toBe('');
    newPrefs.images.namespace = origPrefs.images.namespace;
    expect(newPrefs).toEqual(origPrefs);
  });

  test('should change several values (and no others)', () => {
    const newPrefs = updateFromCommandLine(prefs, lockedSettings, [
      '--kubernetes.options.traefik=false',
      '--application.telemetry.enabled=false',
      '--portForwarding.includeKubernetesServices=true',
      '--containerEngine.name=containerd',
      '--kubernetes.port', '6444',
    ]);

    expect(newPrefs.kubernetes.options.traefik).toBeFalsy();
    expect(newPrefs.application.telemetry.enabled).toBeFalsy();
    expect(newPrefs.portForwarding.includeKubernetesServices).toBeTruthy();
    expect(newPrefs.containerEngine.name).toBe('containerd');
    expect(newPrefs.kubernetes.port).toBe(6444);

    newPrefs.kubernetes.options.traefik = true;
    newPrefs.application.telemetry.enabled = true;
    newPrefs.portForwarding.includeKubernetesServices = false;
    newPrefs.containerEngine.name = settings.ContainerEngine.MOBY;
    newPrefs.kubernetes.port = 6443;
    expect(newPrefs).toEqual(origPrefs);
  });

  test('should ignore non-option arguments', () => {
    const arg = 'doesnt.start.with.dash.dash=some-value';
    const newPrefs = updateFromCommandLine(prefs, lockedSettings, [arg]);

    expect(newPrefs).toEqual(origPrefs);
  });

  test('should ignore an unrecognized option', () => {
    const arg = '--kubernetes.zipperhead';
    const newPrefs = updateFromCommandLine(prefs, lockedSettings, [arg]);

    expect(newPrefs).toEqual(origPrefs);
  });

  test('should ignore leading options and arguments', () => {
    const args = ['--kubernetes.zipperhead', '--another.unknown.option', 'its.argument', '--dont.know.what.this.is.either'];
    const newPrefs = updateFromCommandLine(prefs, lockedSettings, args);

    expect(TransientSettings.value.noModalDialogs).toEqual(false);
    expect(newPrefs).toEqual(origPrefs);
  });

  test('should complain about an unrecognized ignore after a recognized one', () => {
    const args = ['--ignore.this.one', '--kubernetes.enabled', '--complain.about.this'];

    expect(() => {
      updateFromCommandLine(prefs, lockedSettings, args);
    }).toThrow(`Can't evaluate command-line argument ${ args[2] } -- no such entry in current settings`);
  });

  test('should complain about non-options after recognizing an option', () => {
    const args = ['--kubernetes.enabled', 'doesnt.start.with.dash.dash=some-value'];

    expect(() => {
      updateFromCommandLine(prefs, lockedSettings, args);
    }).toThrow(`Unexpected argument '${ args[1] }'`);
  });

  test('should refuse to overwrite a non-leaf node', () => {
    const arg = '--kubernetes.options';

    expect(() => {
      updateFromCommandLine(prefs, lockedSettings, [arg, '33']);
    }).toThrow(`Can't overwrite existing setting ${ arg }`);
  });

  test('should complain about a missing string value', () => {
    const arg = '--kubernetes.version';

    expect(() => {
      updateFromCommandLine(prefs, lockedSettings, [arg]);
    }).toThrow(`No value provided for option ${ arg }`);
  });

  test('should complain about a missing numeric value', () => {
    const arg = '--virtualMachine.memoryInGB';

    expect(() => {
      updateFromCommandLine(prefs, lockedSettings, ['--kubernetes.version', '1.2.3', arg]);
    }).toThrow(`No value provided for option ${ arg }`);
  });

  test('should complain about a non-boolean value', () => {
    const arg = '--kubernetes.enabled';
    const value = 'nope';

    expect(() => {
      updateFromCommandLine(prefs, lockedSettings, [`${ arg }=${ value }`]);
    }).toThrow(`Can't evaluate ${ arg }=${ value } as boolean`);
  });

  test('should complain about a non-numeric value', () => {
    const arg = '--kubernetes.port';
    const value = 'angeles';

    expect(() => {
      updateFromCommandLine(prefs, lockedSettings, [`${ arg }=${ value }`]);
    }).toThrow(`Can't evaluate ${ arg }=${ value } as number: SyntaxError: Unexpected token a in JSON at position 0`);
  });

  test('should complain about type mismatches', () => {
    const optionList = [
      ['--virtualMachine.memoryInGB', 'true', 'boolean', 'number'],
      ['--kubernetes.enabled', '7', 'number', 'boolean'],
    ];

    for (const [arg, finalValue, currentType, desiredType] of optionList) {
      expect(() => {
        updateFromCommandLine(prefs, lockedSettings, [`${ arg }=${ finalValue }`]);
      }).toThrow(`Type of '${ finalValue }' is ${ currentType }, but current type of ${ arg.substring(2) } is ${ desiredType } `);
    }
  });

  describe('--no-modal-dialogs', () => {
    test('sets the value accordingly', () => {
      TransientSettings.update({ noModalDialogs: false });
      updateFromCommandLine(prefs, lockedSettings, ['--no-modal-dialogs']);
      expect(TransientSettings.value.noModalDialogs).toBeTruthy();
      TransientSettings.update({ noModalDialogs: false });
      updateFromCommandLine(prefs, lockedSettings, ['--no-modal-dialogs=true']);
      expect(TransientSettings.value.noModalDialogs).toBeTruthy();
      updateFromCommandLine(prefs, lockedSettings, ['--no-modal-dialogs=false']);
      expect(TransientSettings.value.noModalDialogs).toBeFalsy();
    });

    test('complains about an invalid argument', () => {
      const arg = '--no-modal-dialogs=42';

      expect(() => {
        updateFromCommandLine(prefs, lockedSettings, [arg]);
      }).toThrow(`Invalid associated value for ${ arg }: must be unspecified (set to true), true or false`);
    });
  });
});
