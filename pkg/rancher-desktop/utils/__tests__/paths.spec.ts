import os from 'os';
import path from 'path';

import paths, { Paths } from '../paths';

const RESOURCES_PATH = path.join(process.cwd(), 'resources');

type Platform = 'darwin' | 'linux' | 'win32';
type expectedData = Record<Platform, string | Error>;

jest.mock('electron', () => {
  return {
    __esModule: true,
    default:    {
      app: {
        isPackaged: false,
        getAppPath: () => process.cwd(),
      },
    },
  };
});

describe('paths', () => {
  const cases: Record<keyof Paths, expectedData> = {
    appHome: {
      win32:  '%APPDATA%/rancher-desktop/',
      linux:  '%HOME%/.local/share/rancher-desktop/',
      darwin: '%HOME%/Library/Application Support/rancher-desktop/',
    },
    altAppHome: {
      win32:  '%APPDATA%/rancher-desktop/',
      linux:  '%HOME%/.rd/',
      darwin: '%HOME%/.rd/',
    },
    config: {
      win32:  '%APPDATA%/rancher-desktop/',
      linux:  '%HOME%/.config/rancher-desktop/',
      darwin: '%HOME%/Library/Preferences/rancher-desktop/',
    },
    logs: {
      win32:  '%LOCALAPPDATA%/rancher-desktop/logs/',
      linux:  '%HOME%/.local/share/rancher-desktop/logs/',
      darwin: '%HOME%/Library/Logs/rancher-desktop/',
    },
    cache: {
      win32:  '%LOCALAPPDATA%/rancher-desktop/cache/',
      linux:  '%HOME%/.cache/rancher-desktop/',
      darwin: '%HOME%/Library/Caches/rancher-desktop/',
    },
    wslDistro: {
      win32:  '%LOCALAPPDATA%/rancher-desktop/distro/',
      linux:  new Error('wslDistro'),
      darwin: new Error('wslDistro'),
    },
    wslDistroData: {
      win32:  '%LOCALAPPDATA%/rancher-desktop/distro-data/',
      linux:  new Error('wslDistroData'),
      darwin: new Error('wslDistroData'),
    },
    lima: {
      win32:  new Error('lima'),
      linux:  '%HOME%/.local/share/rancher-desktop/lima/',
      darwin: '%HOME%/Library/Application Support/rancher-desktop/lima/',
    },
    integration: {
      win32:  new Error('integration'),
      linux:  '%HOME%/.rd/bin',
      darwin: '%HOME%/.rd/bin',
    },
    resources: {
      win32:  RESOURCES_PATH,
      linux:  RESOURCES_PATH,
      darwin: RESOURCES_PATH,
    },
    deploymentProfileSystem: {
      win32:  new Error('Windows profiles will be read from Registry'),
      linux:  '/etc/rancher-desktop',
      darwin: '/Library/Preferences',
    },
    deploymentProfileUser: {
      win32:  new Error('Windows profiles will be read from Registry'),
      linux:  '%HOME%/.config',
      darwin: '%HOME%/Library/Preferences',
    },
    extensionRoot: {
      win32:  '%LOCALAPPDATA%/rancher-desktop/extensions/',
      linux:  '%HOME%/.local/share/rancher-desktop/extensions/',
      darwin: '%HOME%/Library/Application Support/rancher-desktop/extensions/',
    },
    snapshots: {
      win32:  new Error('not implemented'),
      linux:  '%HOME%/.local/share/rancher-desktop/snapshots/',
      darwin: '%HOME%/Library/Application Support/rancher-desktop/snapshots/',
    },
  };

  const table = Object.entries(cases).flatMap(
    ([prop, data]) => Object.entries(data).map<[string, Platform, string|Error]>(
      ([platform, expected]) => [prop, platform as Platform, expected],
    ),
  ).filter(([_, platform]) => platform === process.platform);

  // Make a fake environment, because these would not be available on mac.
  const env = Object.assign(process.env, {
    APPDATA:      path.join(os.homedir(), 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(os.homedir(), 'AppData', 'Local'),
  });

  test.each(table)('.%s (%s)', (prop, _, expected) => {
    const propName = prop as keyof Paths;

    if (expected instanceof Error) {
      expect(() => paths[propName]).toThrow();
    } else {
      const replaceEnv = (_: string, name: string) => {
        const result = env[name];

        if (!result) {
          throw new Error(`Missing environment variable ${ name }`);
        }

        return result;
      };
      const replaced = expected.replace(/%(.*?)%/g, replaceEnv);
      const cleaned = path.normalize(path.resolve(replaced, '.'));
      const actual = path.normalize(path.resolve(paths[propName]));

      expect(actual).toEqual(cleaned);
    }
  });

  it('lima should be in one of the main subtrees', () => {
    const pathsToDelete = [paths.cache, paths.appHome, paths.config, paths.logs];
    const platform = os.platform();

    if (['darwin', 'linux'].includes(platform)) {
      expect(pathsToDelete.some( dir => paths.lima.startsWith(dir))).toBeTruthy();
      expect(pathsToDelete.some( dir => '/bobs/friendly/llama/farm'.startsWith(dir))).toBeFalsy();
    }
  });
});
