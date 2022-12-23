import os from 'os';

import Electron, { BrowserWindow, app, shell } from 'electron';

import { openPreferences } from './preferences';

import * as K8s from '@pkg/backend/k8s';
import { IpcRendererEvents } from '@pkg/typings/electron-ipc';
import { isDevEnv } from '@pkg/utils/environment';
import Logging from '@pkg/utils/logging';

const console = Logging.background;

/**
 * A mapping of window key (which is our own construct) to a window ID (which is
 * assigned by electron).
 */
export const windowMapping: Record<string, number> = {};

export const webRoot = `app://${ isDevEnv ? '' : '.' }`;

/**
 * Restore or focus a window if it is already open
 * @param window The Electron Browser window to show or restore
 * @returns Boolean: True if the browser window is shown or restored
 */
export const restoreWindow = (window: Electron.BrowserWindow | null): window is Electron.BrowserWindow => {
  if (window) {
    if (!window.isFocused()) {
      if (window.isMinimized()) {
        window.restore();
      }
      window.show();
    }

    return true;
  }

  return false;
};

/**
 * Return an existing window of the given ID.
 */
export function getWindow(name: string): Electron.BrowserWindow | null {
  return (name in windowMapping) ? BrowserWindow.fromId(windowMapping[name]) : null;
}

/**
 * Open a given window; if it is already open, focus it.
 * @param name The window identifier; this controls window re-use.
 * @param url The URL to load into the window.
 * @param options A hash of options used by `new BrowserWindow(options)`
 * @param prefs Options to control the new window.
 */
export function createWindow(name: string, url: string, options: Electron.BrowserWindowConstructorOptions) {
  let window = getWindow(name);

  if (restoreWindow(window)) {
    return window;
  }

  const isInternalURL = (url: string) => {
    return url.startsWith(`${ webRoot }/`);
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
  console.debug('createWindow() name:', name, ' url:', url);
  window.loadURL(url);
  windowMapping[name] = window.id;

  return window;
}

const mainUrl = process.env.RD_ENV_PLUGINS_DEV ? 'https://localhost:8888' : `${ webRoot }/index.html`;

/**
 * Open the main window; if it is already open, focus it.
 */
export function openMain(showPreferencesModal = false) {
  console.debug('openMain() webRoot:', webRoot);
  const window = createWindow(
    'main',
    mainUrl,
    {
      width:          940,
      height:         600,
      webPreferences: {
        devTools:         !app.isPackaged,
        nodeIntegration:  true,
        contextIsolation: false,
      },
    });

  app.dock?.show();

  if (showPreferencesModal) {
    openPreferences();
  }

  window.webContents.on('ipc-message', (_event, channel) => {
    if (channel === 'app-ready' && showPreferencesModal) {
      openPreferences();
    }
  });
}

/**
 * Attempts to resize and center window on parent or screen
 * @param window Electron Browser Window that needs to be resized
 * @param width Width of the browser window
 * @param height Height of the browser window
 */
function resizeWindow(window: Electron.BrowserWindow, width: number, height: number): void {
  const parent = window.getParentWindow();

  if (!parent) {
    window.center();
    window.setContentSize(width, height);

    return;
  }

  const { x: prefX, y: prefY, width: prefWidth } = parent.getBounds();
  const centered = prefX + Math.round((prefWidth / 2) - (width / 2));

  window.setContentBounds(
    {
      x: centered, y: prefY, width, height,
    },
  );
}

/**
 * Internal helper function to open a given modal dialog. Note that you
 * may have to send the dialog/ready event from ipcRenderer to get
 * your dialog to show.
 *
 * @param id The URL for the dialog, corresponds to a Nuxt page; e.g. FirstRun.
 * @returns The opened window
 */
export function openDialog(id: string, opts?: Electron.BrowserWindowConstructorOptions) {
  console.debug('openDialog() id: ', id);
  const window = createWindow(
    id,
    // We use hash mode for the router, so `index.html#FirstRun` loads
    // pkg/rancher-desktop/pages/FirstRun.vue.
    `${ webRoot }/index.html#${ id }`,
    {
      width:           100,
      height:          100,
      autoHideMenuBar: !app.isPackaged,
      show:            false,
      modal:           true,
      resizable:       false,
      frame:           !(os.platform() === 'linux'),
      ...opts ?? {},
      webPreferences:  {
        devTools:                !app.isPackaged,
        nodeIntegration:         true, // required for ipcRenderer
        contextIsolation:        false,
        enablePreferredSizeMode: true,
        ...opts?.webPreferences ?? {},
      },
    },
  );

  window.menuBarVisible = false;

  window.webContents.on('ipc-message', (_event, channel) => {
    if (channel === 'dialog/ready') {
      window.show();
    }
  });

  window.webContents.on('preferred-size-changed', (_event, { width, height }) => {
    if (os.platform() === 'linux') {
      resizeWindow(window, width, height);
    } else {
      window.setContentSize(width, height, true);
    }
  });

  return window;
}

/**
 * Open the first run window, and return once the user has accepted any
 * configuration required.
 */
export async function openFirstRunDialog() {
  const window = openDialog('FirstRun', { frame: true });

  await (new Promise<void>((resolve) => {
    window.on('closed', resolve);
  }));
}

/**
 * Open a dialog warning the user that RD cannot be run as root/administrator,
 * and return once the user has acknowledged this.
 */
export async function openDenyRootDialog() {
  const window = openDialog('DenyRoot', {
    frame:  true,
    width:  336,
    height: 170,
  });

  await (new Promise<void>((resolve) => {
    window.on('closed', resolve);
  }));
}

export type reqMessageId = 'ok' | 'linux-nested' | 'win32-release' | 'macOS-release';

/**
 * Open a dialog to show reason Desktop will not start
 * @param reasonId Specifies which message to show in dialog
 */
export async function openUnmetPrerequisitesDialog(reasonId: reqMessageId) {
  const window = openDialog('UnmetPrerequisites', { frame: true });

  window.webContents.on('ipc-message', (event, channel) => {
    if (channel === 'dialog/load') {
      window.webContents.send('dialog/populate', reasonId);
    }
  });
  await (new Promise<void>((resolve) => {
    window.on('closed', resolve);
  }));
}

/**
 * Open the error message window as a modal window.
 */
export async function openKubernetesErrorMessageWindow(titlePart: string, mainMessage: string, failureDetails: K8s.FailureDetails) {
  const window = openDialog('KubernetesError', {
    title:  `Rancher Desktop - Kubernetes Error`,
    width:  800,
    height: 494,
    parent: getWindow('main') ?? undefined,
    frame:  true,
  });

  window.webContents.on('ipc-message', (event, channel) => {
    if (channel === 'dialog/load') {
      window.webContents.send('dialog/populate', titlePart, mainMessage, failureDetails);
    }
  });
  await (new Promise<void>((resolve) => {
    window.on('closed', resolve);
  }));
}

/**
 * Show the prompt describing why we would like sudo permissions.
 *
 * @param explanations A list of reasons why we want sudo permissions.
 * @returns A promise that is resolved when the window closes. It is true if
 *   the user does not want to allow sudo, and never wants to see the prompt
 *   again.
 */
export async function openSudoPrompt(explanations: Record<string, string[]>): Promise<boolean> {
  const window = openDialog('SudoPrompt', { parent: getWindow('main') ?? undefined });

  /**
   * The result of the dialog; this is true if the user asked to never be
   * prompted again (and therefore we should not attempt to run sudo).
   */
  let result = false;

  window.webContents.on('ipc-message', (event, channel, ...args) => {
    if (channel === 'dialog/load') {
      window.webContents.send('dialog/populate', explanations);
    } else if (channel === 'sudo-prompt/closed') {
      result = args[0] ?? false;
    }
  });
  await (new Promise<void>((resolve) => {
    window.on('closed', resolve);
  }));

  return result;
}

export async function openPathUpdate(): Promise<void> {
  const window = openDialog(
    'PathUpdate',
    {
      title:  'Rancher Desktop - Update',
      frame:  true,
      parent: getWindow('main') ?? undefined,
    });

  await (new Promise<void>((resolve) => {
    window.on('closed', resolve);
  }));
}

export async function openLegacyIntegrations(): Promise<void> {
  const window = openDialog(
    'LegacyIntegrationNotification',
    {
      title:  'Rancher Desktop - Legacy Integrations',
      parent: getWindow('main') ?? undefined,
    },
  );

  await (new Promise<void>((resolve) => {
    window.on('closed', resolve);
  }));
}

export async function showMessageBox(options: Electron.MessageBoxOptions, couldBeModal = false) {
  const mainWindow = couldBeModal ? getWindow('main') : null;

  return await (mainWindow ? Electron.dialog.showMessageBox(mainWindow, options) : Electron.dialog.showMessageBox(options));
}

/**
 * Send a message to all windows in the renderer process.
 * @param channel The channel to send on.
 * @param  args Any arguments to pass.
 */
export function send<eventName extends keyof IpcRendererEvents>(
  channel: eventName,
  ...args: Parameters<IpcRendererEvents[eventName]>
): void;
/** @deprecated The channel to send on must be declared. */
export function send(channel: string, ...args: any[]) {
  for (const windowId of Object.values(windowMapping)) {
    const window = BrowserWindow.fromId(windowId);

    if (window && !window.isDestroyed()) {
      window.webContents.send(channel, ...args);
    }
  }
}
