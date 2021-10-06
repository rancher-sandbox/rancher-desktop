import os from 'os';
import path from 'path';

import paths, { Paths, DarwinPaths, Win32Paths } from '../paths';

type platform = 'darwin' | 'win32';
type expectedData = Record<platform, string | Error>;

describe('paths', () => {
  const cases: Record<keyof Paths, expectedData> = {
    config: {
      win32:  '%APPDATA%/rancher-desktop/',
      darwin: '%HOME%/Library/Preferences/rancher-desktop/',
    },
    logs: {
      win32:  '%LOCALAPPDATA%/rancher-desktop/logs/',
      darwin: '%HOME%/Library/Logs/rancher-desktop/'
    },
    cache: {
      win32:  '%LOCALAPPDATA%/rancher-desktop/cache/',
      darwin: '%HOME%/Library/Caches/rancher-desktop/',
    },
    wslDistro: {
      win32:  '%LOCALAPPDATA%/rancher-desktop/distro/',
      darwin: Error(),
    },
    wslDistroData: {
      win32:  '%LOCALAPPDATA%/rancher-desktop/distro-data/',
      darwin: Error(),

    },
    lima: {
      win32:  Error(),
      darwin: '%HOME%/Library/Application Support/rancher-desktop/lima/',
    },
    hyperkit: {
      win32:  Error(),
      darwin: '%HOME%/Library/State/rancher-desktop/driver/',
    },
    integration: {
      win32:  Error(),
      darwin: '/usr/local/bin',
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

  test.each(table)('.%s (%s)', (prop, platform, expected) => {
    const propName = prop as keyof Paths;
    let paths: Paths;

    switch (platform) {
    case 'darwin':
      paths = new DarwinPaths();
      break;
    case 'win32':
      paths = new Win32Paths();
      break;
    default:
      throw new Error(`Unexpected platform ${ platform }`);
    }

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
    switch (os.platform()) {
    case 'darwin':
      expect(paths).toBeInstanceOf(DarwinPaths);
      break;
    case 'win32':
      expect(paths).toBeInstanceOf(Win32Paths);
      break;
    default:
      console.log(`Skipping platform-specific test on unknown platform ${ os.platform() }`);
    }
  });
});
