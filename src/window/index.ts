'use strict';

import { BrowserWindow, app, shell } from 'electron';

import Logging from '@/utils/logging';

const console = Logging.background;

/**
 * A mapping of window key (which is our own construct) to a window ID (which is
 * assigned by electron).
 */
const windowMapping: Record<string, number> = {};

function getWebRoot() {
  if (/^(?:dev|test)/i.test(process.env.NODE_ENV || '')) {
    return 'http://localhost:8888';
  }

  return 'app://.';
}

/**
 * Open a given window; if it is already open, focus it.
 * @param name The window identifier; this controls window re-use.
 * @param url The URL to load into the window.
 * @param prefs Options to control the new window.
 */
function createWindow(name: string, url: string, options: Electron.BrowserWindowConstructorOptions) {
  let window = (name in windowMapping) ? BrowserWindow.fromId(windowMapping[name]) : null;

  if (window) {
    if (!window.isFocused()) {
      if (window.isMinimized()) {
        window.restore();
      }
      window.show();
    }

    return window;
  }

  const isInternalURL = (url: string) => {
    return url.startsWith(`${ getWebRoot() }/`);
  };

  window = new BrowserWindow(options);
  window.webContents.on('will-navigate', (event, input) => {
    if (isInternalURL(input)) {
      return;
    }
    shell.openExternal(input);
    event.preventDefault();
  });
  window.webContents.setWindowOpenHandler((details) => {
    if (isInternalURL(details.url)) {
      window?.webContents.loadURL(details.url);
    } else {
      shell.openExternal(details.url);
    }

    return { action: 'deny' };
  });
  window.webContents.on('did-fail-load', (event, errorCode, errorDescription, url) => {
    console.log(`Failed to load ${ url }: ${ errorCode } (${ errorDescription })`);
  });
  window.loadURL(url);
  windowMapping[name] = window.id;

  return window;
}

/**
 * Open the preferences window; if it is already open, focus it.
 */
export function openPreferences() {
  const webRoot = getWebRoot();

  createWindow('preferences', `${ webRoot }/index.html`, {
    width:          940,
    height:         600,
    webPreferences: {
      devTools:           !(app.isPackaged || process.env?.NODE_ENV === 'test'),
      nodeIntegration:    true,
      contextIsolation:   false,
      enableRemoteModule: process.env?.NODE_ENV === 'test'
    },
  });
  app.dock?.show();
}

/**
 * Open the first run window, and return once the user has accepted any
 * configuration required.
 */
export async function openFirstRun() {
  const webRoot = getWebRoot();
  // We use hash mode for the router, so `index.html#FirstRun` loads
  // src/pages/FirstRun.vue.
  const window = createWindow('first-run', `${ webRoot }/index.html#FirstRun`, {
    width:           400,
    height:          200,
    autoHideMenuBar: !app.isPackaged,
    show:            false,
    webPreferences:  {
      devTools:           !(app.isPackaged || process.env?.NODE_ENV === 'test'),
      nodeIntegration:    true,
      contextIsolation:   false,
      enableRemoteModule: process.env?.NODE_ENV === 'test'
    },
  });

  window.webContents.on('ipc-message', (event, channel) => {
    if (channel === 'firstrun/ready') {
      window.show();
    }
  });
  window.menuBarVisible = false;
  await (new Promise<void>((resolve) => {
    window.on('closed', resolve);
  }));
}

/**
 * Send a message to all windows in the renderer process.
 * @param channel The channel to send on.
 * @param  args Any arguments to pass.
 */
export function send(channel: string, ...args: any[]) {
  for (const windowId of Object.values(windowMapping)) {
    const window = BrowserWindow.fromId(windowId);

    window?.webContents?.send(channel, ...args);
  }
}
