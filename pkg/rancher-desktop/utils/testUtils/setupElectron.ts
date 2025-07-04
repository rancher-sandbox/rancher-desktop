/**
 * This file is preloaded into all Jest tests (see package.json,
 * `jest.setupFiles`) and is used to force-mock Electron as that does not work
 * inside Jest.
 */

import path from 'path';

import { jest } from '@jest/globals';

jest.unstable_mockModule('electron', () => {
  const exports = {
    app: {
      isPackaged: false,
      getAppPath: () => path.resolve('.'),
    },
    BrowserWindow: {},
    dialog: {},
    ipcMain: {},
    ipcRenderer: {},
    nativeTheme: {},
    screen: {},
    shell: {},
    WebContentsView: {},
  };

  return {
    __esModule: true,
    default:    exports,
    ...exports,
  };
});
