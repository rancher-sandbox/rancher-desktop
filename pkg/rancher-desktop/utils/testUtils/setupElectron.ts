/**
 * This file is preloaded into all Jest tests (see package.json,
 * `jest.setupFiles`) and is used to force-mock Electron as that does not work
 * inside Jest.
 */

import path from 'path';

if ('jest' in globalThis && 'mock' in jest) {
  jest.mock('electron', () => {
    return {
      __esModule: true,
      default:    {
        app: {
          isPackaged: false,
          getAppPath: () => path.resolve('.'),
        },
        ipcMain: {},
      },
    };
  });
}
