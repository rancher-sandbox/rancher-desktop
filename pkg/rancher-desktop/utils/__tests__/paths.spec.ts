import os from 'os';
import path from 'path';

import paths, { Paths, DarwinPaths, Win32Paths, LinuxPaths } from '../paths';

const CURRENT_DIR = path.resolve('.');
const RESOURCES_PATH = path.join(CURRENT_DIR, 'resources');

type platform = 'darwin' | 'linux' | 'win32';
type expectedData = Record<platform, string | Error>;

jest.mock('electron', () => {
  return {
    __esModule: true,
    default:    {
      app: {
        isPackaged: false,
        getAppPath: () => CURRENT_DIR,
      },
    },
  };
});

describe('paths', () => {
  const cases: Record<keyof Paths, expectedData> = {
    appHome: {
      win32:  '%APPDATA%/rancher-desktop/',
      linux:  '%HOME%/.config/rancher-desktop/',
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
    oldIntegration: {
      win32:  new Error('oldIntegration'),
      linux:  '%HOME%/.local/bin',
      darwin: '/usr/local/bin',
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
  };

  const table = Object.entries(cases).flatMap(
    ([prop, data]) => Object.entries(data).map<[string, platform, string|Error]>(
      ([platform, expected]) => [prop, platform as platform, expected]));

  // Make a fake environment, because these would not be available on mac.
  const env = Object.assign(process.env, {
    APPDATA:      path.join(os.homedir(), 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(os.homedir(), 'AppData', 'Local'),
  });

  const pathsConstructor: Record<platform, new() => Paths> = {
    darwin: DarwinPaths,
    linux:  LinuxPaths,
    win32:  Win32Paths,
  };

  test.each(table)('.%s (%s)', (prop, platform, expected) => {
    expect(pathsConstructor).toHaveProperty(platform);

    const propName = prop as keyof Paths;
    const paths = new pathsConstructor[platform]();

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

  it('should should be for the correct platform', () => {
    const platform = os.platform();

    expect(pathsConstructor).toHaveProperty(platform);
    expect(paths).toBeInstanceOf(pathsConstructor[os.platform() as platform]);
  });

  it('lima should be in one of the main subtrees', () => {
    const pathsToDelete = [paths.cache, paths.appHome, paths.config, paths.logs];
    const platform = os.platform();

    if (['darwin', 'linux'].includes(platform)) {
      expect(pathsToDelete.some( dir => paths.lima.startsWith(dir))).toEqual(platform === 'darwin');
      expect(pathsToDelete.some( dir => '/bobs/friendly/llama/farm'.startsWith(dir))).toBeFalsy();
    }
  });
});
