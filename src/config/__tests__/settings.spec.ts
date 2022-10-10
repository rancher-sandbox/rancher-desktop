import fs from 'fs';

import * as settings from '../settings';

import { PathManagementStrategy } from '@/integrations/pathManager';
import clone from '@/utils/clone';

describe('updateFromCommandLine', () => {
  let prefs: settings.Settings;
  let origPrefs: settings.Settings;

  beforeEach(() => {
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => { });
    prefs = {
      version:    4,
      kubernetes: {
        version:                    '1.23.5',
        memoryInGB:                 4,
        numberCPUs:                 2,
        port:                       6443,
        containerEngine:            settings.ContainerEngine.MOBY,
        checkForExistingKimBuilder: false,
        enabled:                    true,
        WSLIntegrations:            {},
        options:                    {
          traefik: true,
          flannel: false,
        },
        suppressSudo:             false,
        hostResolver:             true,
        experimental: { socketVMNet: true },
      },
      portForwarding: { includeKubernetesServices: false },
      images:         {
        showAll:   true,
        namespace: 'k8s.io',
      },
      telemetry:              true,
      updater:                true,
      debug:                  true,
      pathManagementStrategy: PathManagementStrategy.NotSet,
      minimizeOnClose: false,
      diagnostics:            {
        showMuted:   false,
        mutedChecks: { },
      },
    };
    origPrefs = clone(prefs);
  });

  describe('getUpdatableNode', () => {
    test('returns null on an invalid top level accessor', () => {
      const result = settings.getUpdatableNode(prefs, 'blah-blah-blah');

      expect(result).toBeNull();
    });
    test('returns null on an invalid internal accessor', () => {
      const result = settings.getUpdatableNode(prefs, 'kubernetes-options-blah');

      expect(result).toBeNull();
    });
    test('returns the full pref with a top-level accessor', () => {
      const result = settings.getUpdatableNode(prefs, 'kubernetes') as [Record<string, any>, string];

      expect(result).not.toBeNull();
      const [lhs, accessor] = result;

      expect(lhs).toEqual(prefs);
      expect(accessor).toBe('kubernetes');
    });
    test('returns a partial pref with an internal accessor', () => {
      const result = settings.getUpdatableNode(prefs, 'kubernetes-options-flannel') as [Record<string, any>, string];

      expect(result).not.toBeNull();
      const [lhs, accessor] = result;
      const flannelNow = prefs.kubernetes.options.flannel;
      const flannelAfter = !flannelNow;

      expect(lhs).toEqual({
        ...origPrefs.kubernetes.options,
        flannel: flannelNow,
      });
      expect(accessor).toBe('flannel');
      lhs[accessor] = flannelAfter;
      expect(prefs.kubernetes.options.flannel).toBe(flannelAfter);
    });
  });

  test('no command-line args should leave prefs unchanged', () => {
    const newPrefs = settings.updateFromCommandLine(prefs, [])[1];

    expect(newPrefs).toEqual(origPrefs);
  });

  test('one option with embedded equal sign should change only one value', () => {
    const newPrefs = settings.updateFromCommandLine(prefs, ['--kubernetes-version=1.23.6'])[1];

    expect(newPrefs.kubernetes.version).toBe('1.23.6');
    newPrefs.kubernetes.version = origPrefs.kubernetes.version;
    expect(newPrefs).toEqual(origPrefs);
  });

  test('one option over two args should change only one value', () => {
    const newPrefs = settings.updateFromCommandLine(prefs, ['--kubernetes-version', '1.23.7'])[1];

    expect(newPrefs.kubernetes.version).toBe('1.23.7');
    newPrefs.kubernetes.version = origPrefs.kubernetes.version;
    expect(newPrefs).toEqual(origPrefs);
  });

  test('boolean option to true should change only that value', () => {
    const newPrefs = settings.updateFromCommandLine(prefs, ['--kubernetes-options-flannel=true'])[1];

    expect(origPrefs.kubernetes.options.flannel).toBeFalsy();
    expect(newPrefs.kubernetes.options.flannel).toBeTruthy();
    newPrefs.kubernetes.options.flannel = false;
    expect(newPrefs).toEqual(origPrefs);
  });

  test('boolean option set to implicit true should change only that value', () => {
    const newPrefs = settings.updateFromCommandLine(prefs, ['--kubernetes-suppressSudo'])[1];

    expect(origPrefs.kubernetes.suppressSudo).toBeFalsy();
    expect(newPrefs.kubernetes.suppressSudo).toBeTruthy();
    newPrefs.kubernetes.suppressSudo = false;
    expect(newPrefs).toEqual(origPrefs);
  });

  test('boolean option set to false should change only that value', () => {
    const newPrefs = settings.updateFromCommandLine(prefs, ['--kubernetes-options-traefik=false'])[1];

    expect(origPrefs.kubernetes.options.traefik).toBeTruthy();
    expect(newPrefs.kubernetes.options.traefik).toBeFalsy();
    newPrefs.kubernetes.options.traefik = true;
    expect(newPrefs).toEqual(origPrefs);
  });

  test('nothing after an = should set target to empty string', () => {
    const newPrefs = settings.updateFromCommandLine(prefs, ['--images-namespace='])[1];

    expect(origPrefs.images.namespace).not.toBe('');
    expect(newPrefs.images.namespace).toBe('');
    newPrefs.images.namespace = origPrefs.images.namespace;
    expect(newPrefs).toEqual(origPrefs);
  });

  test('should change several values (and no others)', () => {
    const newPrefs = settings.updateFromCommandLine(prefs, [
      '--kubernetes-options-traefik=false',
      '--kubernetes-suppressSudo',
      '--portForwarding-includeKubernetesServices=true',
      '--kubernetes-containerEngine=containerd',
      '--kubernetes-port', '6444',
    ])[1];

    expect(newPrefs.kubernetes.options.traefik).toBeFalsy();
    expect(newPrefs.kubernetes.suppressSudo).toBeTruthy();
    expect(newPrefs.portForwarding.includeKubernetesServices).toBeTruthy();
    expect(newPrefs.kubernetes.containerEngine).toBe('containerd');
    expect(newPrefs.kubernetes.port).toBe(6444);

    newPrefs.kubernetes.options.traefik = true;
    newPrefs.kubernetes.suppressSudo = false;
    newPrefs.portForwarding.includeKubernetesServices = false;
    newPrefs.kubernetes.containerEngine = settings.ContainerEngine.MOBY;
    newPrefs.kubernetes.port = 6443;
    expect(newPrefs).toEqual(origPrefs);
  });

  test('should ignore non-option arguments', () => {
    const arg = 'doesnt-start-with-dash-dash=some-value';
    const newPrefs = settings.updateFromCommandLine(prefs, [arg])[1];

    expect(newPrefs).toEqual(origPrefs);
  });

  test('should ignore an unrecognized option', () => {
    const arg = '--kubernetes-zipperhead';
    const newPrefs = settings.updateFromCommandLine(prefs, [arg])[1];

    expect(newPrefs).toEqual(origPrefs);
  });

  test('should ignore leading options and arguments', () => {
    const args = ['--kubernetes-zipperhead', '--another-unknown-option', 'its-argument', '--dont-know-what-this-is-either'];
    const [transientSettings, newPrefs] = settings.updateFromCommandLine(prefs, args);

    expect(transientSettings).toEqual({ noModalDialogs: false });
    expect(newPrefs).toEqual(origPrefs);
  });

  test('should complain about an unrecognized ignore after a recognized one', () => {
    const args = ['--ignore-this-one', '--kubernetes-enabled', '--complain-about-this'];

    expect(() => {
      settings.updateFromCommandLine(prefs, args);
    }).toThrow(`Can't evaluate command-line argument ${ args[2] } -- no such entry in current settings`);
  });

  test('should complain about non-options after recognizing an option', () => {
    const args = ['--kubernetes-enabled', 'doesnt-start-with-dash-dash=some-value'];

    expect(() => {
      settings.updateFromCommandLine(prefs, args);
    }).toThrow(`Unexpected argument '${ args[1] }'`);
  });

  test('should refuse to overwrite a non-leaf node', () => {
    const arg = '--kubernetes-options';

    expect(() => {
      settings.updateFromCommandLine(prefs, [arg, '33']);
    }).toThrow(`Can't overwrite existing setting ${ arg }`);
  });

  test('should complain about a missing string value', () => {
    const arg = '--kubernetes-version';

    expect(() => {
      settings.updateFromCommandLine(prefs, [arg]);
    }).toThrow(`No value provided for option ${ arg }`);
  });

  test('should complain about a missing numeric value', () => {
    const arg = '--kubernetes-memoryInGB';

    expect(() => {
      settings.updateFromCommandLine(prefs, ['--kubernetes-version', '1.2.3', arg]);
    }).toThrow(`No value provided for option ${ arg }`);
  });

  test('should complain about a non-boolean value', () => {
    const arg = '--kubernetes-enabled';
    const value = 'nope';

    expect(() => {
      settings.updateFromCommandLine(prefs, [`${ arg }=${ value }`]);
    }).toThrow(`Can't evaluate ${ arg }=${ value } as boolean`);
  });

  test('should complain about a non-numeric value', () => {
    const arg = '--kubernetes-port';
    const value = 'angeles';

    expect(() => {
      settings.updateFromCommandLine(prefs, [`${ arg }=${ value }`]);
    }).toThrow(`Can't evaluate ${ arg }=${ value } as number: SyntaxError: Unexpected token a in JSON at position 0`);
  });

  test('should complain about type mismatches', () => {
    const optionList = [
      ['--kubernetes-memoryInGB', 'true', 'boolean', 'number'],
      ['--kubernetes-enabled', '7', 'number', 'boolean'],
    ];

    for (const [arg, finalValue, currentType, desiredType] of optionList) {
      expect(() => {
        settings.updateFromCommandLine(prefs, [`${ arg }=${ finalValue }`]);
      }).toThrow(`Type of '${ finalValue }' is ${ currentType }, but current type of ${ arg.substring(2) } is ${ desiredType } `);
    }
  });

  describe('--no-modal-dialogs', () => {
    test('sets the value accordingly', () => {
      settings.transientSettings.noModalDialogs = false;
      settings.updateFromCommandLine(prefs, ['--no-modal-dialogs']);
      expect(settings.transientSettings.noModalDialogs).toBeTruthy();
      settings.transientSettings.noModalDialogs = false;
      settings.updateFromCommandLine(prefs, ['--no-modal-dialogs=true']);
      expect(settings.transientSettings.noModalDialogs).toBeTruthy();
      settings.updateFromCommandLine(prefs, ['--no-modal-dialogs=false']);
      expect(settings.transientSettings.noModalDialogs).toBeFalsy();
    });

    test('complains about an invalid argument', () => {
      const arg = '--no-modal-dialogs=42';

      expect(() => {
        settings.updateFromCommandLine(prefs, [arg]);
      }).toThrow(`Invalid associated value for ${ arg }: must be unspecified (set to true), true or false`);
    });
  });
});
