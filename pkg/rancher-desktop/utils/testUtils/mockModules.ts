import { jest } from '@jest/globals';

const defaultOverrides = {
  '@pkg/utils/logging': () => {
    class Log {
      log = jest.fn();
      error = jest.fn();
      info = jest.fn();
      warn = jest.fn();
      debug = jest.fn();
      debugE = jest.fn();
    }
    return ({
      __esModule: true,
      Log,
      default: new Proxy({}, {
        get: (target, prop, receiver) => {
          return new Log();
        }
      }),
    });
  }
}

type defaultOverrideModuleType = { [key in keyof typeof defaultOverrides]: undefined };
type explicitModuleType = Record<string, any>;
type mockModuleParamType = Record<string, explicitModuleType> | defaultOverrideModuleType;

/**
 * This is a helper function to mock ES modules.
 * @param modules The modules to mock; the key is the module name (e.g. `os`),
 * and the values are the things to export (e.g. `{arch: jest.fn(() => return '68k'}`).
 * @returns The input, to facilitate working with the mocks.
 */
export default function mockModules<T extends mockModuleParamType>(modules: T): T {
  for (const [name, exports] of Object.entries(modules)) {
    if (exports === undefined && name in defaultOverrides) {
      jest.unstable_mockModule(name, defaultOverrides[name as keyof typeof defaultOverrides]);
    } else {
      jest.unstable_mockModule(name, () => ({
        __esModule: true,
        default:    exports,
        ...exports,
      }));
    }
  }

  return modules;
}
