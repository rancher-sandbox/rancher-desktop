import * as settings from '../settings';
import { PathManagementStrategy } from '@/integrations/pathManager';
import { RecursivePartial } from '~/utils/typeUtils';

describe('updateFromCommandLine', () => {
  let prefs: settings.Settings;

  beforeEach(() => {
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
        suppressSudo: false
      },
      portForwarding: { includeKubernetesServices: false },
      images:         {
        showAll:   true,
        namespace: 'k8s.io'
      },
      telemetry:              true,
      updater:                true,
      debug:                  true,
      pathManagementStrategy: PathManagementStrategy.NotSet,
    };
  });

  describe('getUpdatableNode', () => {
    test('returns nil on an invalid top level accessor', () => {
      const result = settings.getUpdatableNode(prefs, 'blah-blah-blah');

      expect(result).toBeNull();
    });
    test('returns nil on an invalid internal accessor', () => {
      const result = settings.getUpdatableNode(prefs, 'kubernetes-options-blah');

      expect(result).toBeNull();
    });
    test('returns the full pref with a top-level accessor', () => {
      const result = settings.getUpdatableNode(prefs, 'kubernetes');

      if (!result) {
        expect(result).not.toBeNull();
      } else {
        const lhs: RecursivePartial<settings.Settings> = result[0];
        const accessor: string = result[1];

        expect(lhs).toMatchObject(prefs);
        expect(accessor).toBe('kubernetes');
      }
    });
    test('returns a partial pref with an internal accessor', () => {
      const result = settings.getUpdatableNode(prefs, 'kubernetes-options-flannel');

      if (!result) {
        expect(result).not.toBeNull();
      } else {
        const lhs: RecursivePartial<settings.Settings> = result[0];
        const accessor: string = result[1];
        const flannelNow = prefs.kubernetes.options.flannel;
        const flannelAfter = !flannelNow;

        expect(lhs).toMatchObject({
          traefik: prefs.kubernetes.options.traefik,
          flannel: flannelNow,
        });
        expect(accessor).toBe('flannel');
        (lhs as Record<string, any>)[accessor] = flannelAfter;
        expect(prefs.kubernetes.options.flannel).toBe(flannelAfter);
      }
    });
  });

  test('no args should leave prefs unchanged', () => {
    const newPrefs = settings.updateFromCommandLine(prefs, []);

    expect(newPrefs).toMatchObject(prefs);
  });

  test('one option with embedded equal sign should change only one value', () => {
    const newPrefs = settings.updateFromCommandLine(prefs, ['--kubernetes-version=1.23.5']);

    expect(newPrefs.kubernetes.version).toBe('1.23.5');
    newPrefs.kubernetes.version = prefs.kubernetes.version;
    expect(newPrefs).toMatchObject(prefs);
  });

  test('one option over two args should change only one value', () => {
    const newPrefs = settings.updateFromCommandLine(prefs, ['--kubernetes-version', '1.23.5']);

    expect(newPrefs.kubernetes.version).toBe('1.23.5');
    newPrefs.kubernetes.version = prefs.kubernetes.version;
    expect(newPrefs).toMatchObject(prefs);
  });

  test('boolean option to true should change only that value', () => {
    const newPrefs = settings.updateFromCommandLine(prefs, ['--kubernetes-options-flannel=true']);

    expect(newPrefs.kubernetes.options.flannel).toBeTruthy();
    newPrefs.kubernetes.options.flannel = false;
    expect(newPrefs).toMatchObject(prefs);
  });

  test('boolean option to implicit true should change only that value', () => {
    const newPrefs = settings.updateFromCommandLine(prefs, ['--kubernetes-suppressSudo']);

    expect(newPrefs.kubernetes.suppressSudo).toBeTruthy();
    newPrefs.kubernetes.suppressSudo = false;
    expect(newPrefs).toMatchObject(prefs);
  });

  test('boolean option to false should change only that value', () => {
    const newPrefs = settings.updateFromCommandLine(prefs, ['--kubernetes-options-traefik=false']);

    expect(newPrefs.kubernetes.options.traefik).toBeFalsy();
    newPrefs.kubernetes.options.traefik = true;
    expect(newPrefs).toMatchObject(prefs);
  });

  test('should change several values (and no others)', () => {
    const newPrefs = settings.updateFromCommandLine(prefs, [
      '--kubernetes-options-traefik=false',
      '--kubernetes-suppressSudo',
      '--portForwarding-includeKubernetesServices=true',
      '--kubernetes-containerEngine=containerd',
      '--kubernetes-port', '6444'
    ]);

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
    expect(newPrefs).toMatchObject(prefs);
  });

  test('should complain about a non-option', () => {
    const arg = 'doesnt-start-with-dash-dash=some-value';

    expect(() => {
      settings.updateFromCommandLine(prefs, [arg]);
    }).toThrowError(new RegExp(`Unexpected argument '${ arg }'`));
  });

  test('should complain about an unrecognized pref', () => {
    const arg = '--kubernetes-zipperhead';

    expect(() => {
      settings.updateFromCommandLine(prefs, [arg]);
    }).toThrowError(new RegExp(`Can't evaluate command-line argument ${ arg } -- no such entry in current settings`));
  });

  test('should refuse to overwrite a non-leaf node', () => {
    const arg = '--kubernetes-options';

    expect(() => {
      settings.updateFromCommandLine(prefs, [arg, '33']);
    }).toThrowError(new RegExp(`Can't overwrite existing setting ${ arg }`));
  });

  test('should complain about a missing string value', () => {
    const arg = '--kubernetes-version';

    expect(() => {
      settings.updateFromCommandLine(prefs, [arg]);
    }).toThrowError(new RegExp(`No value provided for option ${ arg }`));
  });

  test('should complain about a missing numeric value', () => {
    const arg = '--kubernetes-memoryInGB';

    expect(() => {
      settings.updateFromCommandLine(prefs, ['--kubernetes-version', '1.2.3', arg]);
    }).toThrowError(new RegExp(`No value provided for option ${ arg }`));
  });

  test('should complain about a non-boolean value', () => {
    const arg = '--kubernetes-enabled';
    const value = 'nope';

    expect(() => {
      settings.updateFromCommandLine(prefs, [`${ arg }=${ value }`]);
    }).toThrowError(new RegExp(`Can't evaluate ${ arg }=${ value } as boolean`));
  });

  test('should complain about a non-numeric value', () => {
    const arg = '--kubernetes-port';
    const value = 'angeles';

    expect(() => {
      settings.updateFromCommandLine(prefs, [`${ arg }=${ value }`]);
    }).toThrowError(new RegExp(`Can't evaluate ${ arg }=${ value } as number: SyntaxError: Unexpected token a in JSON at position 0`));
  });

  test('should complain about type mismatches', () => {
    const optionList = [
      ['--kubernetes-memoryInGB', 'true', 'boolean', 'number'],
      ['--kubernetes-enabled', '7', 'number', 'boolean'],
    ];

    for (const [arg, finalValue, currentType, desiredType] of optionList) {
      expect(() => {
        settings.updateFromCommandLine(prefs, [`${ arg }=${ finalValue }`]);
      })
        .toThrowError(new RegExp(`Type of '${ finalValue }' is ${ currentType }, but current type of ${ arg.substring(2) } is ${ desiredType } `));
    }
  });
});
