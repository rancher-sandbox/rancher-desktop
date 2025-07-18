import path from 'node:path';

import { jest } from '@jest/globals';

const defaultOverrides = {
  '@pkg/utils/logging': (() => {
    class Log {
      log = jest.fn();
      error = jest.fn();
      info = jest.fn();
      warn = jest.fn();
      debug = jest.fn();
      debugE = jest.fn();
    }
    return ({
      Log,
      default:    new Proxy({}, {
        get: (target, prop, receiver) => {
          return new Log();
        },
      }),
    });
  })(),
  electron: {
    app: {
      isPackaged: false,
      getAppPath: () => path.resolve('.'),
    },
    BrowserWindow: {},
    dialog:        {},
    ipcMain:       {},
    ipcRenderer:   {},
    nativeTheme:   {},
    net:           {
      fetch: jest.fn<typeof fetch>(() => {
        return Promise.resolve(new Response());
      }),
    },
    screen:          {},
    shell:           {},
    WebContentsView: {},
  },
};

type defaultOutputType = typeof defaultOverrides;
type defaultInputType = { [key in keyof defaultOutputType]: undefined };
type explicitModuleType = Record<string, any>;
type mockModuleParamType = Record<string, explicitModuleType> | Partial<defaultInputType>;
type mockModuleReturnType<T extends mockModuleParamType> = {
  [key in keyof T]:
  key extends keyof defaultOutputType
    ? T[key] extends undefined
      ? defaultOutputType[key]
      : T[key]
    : T[key];
};

/**
 * This is a helper function to mock ES modules.
 * @param modules The modules to mock; the key is the module name (e.g. `os`),
 * and the values are the things to export (e.g. `{arch: jest.fn(() => return '68k'}`).
 * The value may be `undefined`, in which case a default is used.
 * @returns The input, to facilitate working with the mocks.  When the value is
 * `undefined`, it is the default override instead.
 */
export default function mockModules<T extends mockModuleParamType>(modules: T): mockModuleReturnType<T> {
  const results: mockModuleReturnType<T> = {} as any;
  for (let [name, exports] of Object.entries(modules)) {
    if (exports === undefined && name in defaultOverrides) {
      exports = defaultOverrides[name as keyof typeof defaultOverrides];
    }
    jest.unstable_mockModule(name, () => ({
      __esModule: true,
      default:    exports,
      ...exports,
    }));
    (results as any)[name] = exports;
  }

  return results;
}
