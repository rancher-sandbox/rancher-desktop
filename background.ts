import fs from 'fs';
import path from 'path';
import os from 'os';
import { URL } from 'url';

import Electron from 'electron';
import _ from 'lodash';

import mainEvents from '@/main/mainEvents';
import { ImageProcessor } from '@/k8s-engine/images/imageProcessor';
import { ImageProcessorName } from '@/k8s-engine/images/imageFactory';
import { setupImageProcessor } from '@/main/imageEvents';
import * as settings from '@/config/settings';
import * as window from '@/window';
import * as K8s from '@/k8s-engine/k8s';
import resources from '@/resources';
import Logging from '@/utils/logging';
import * as childProcess from '@/utils/childProcess';
import Latch from '@/utils/latch';
import paths from '@/utils/paths';
import setupNetworking from '@/main/networking';
import setupUpdate from '@/main/update';
import setupTray from '@/main/tray';
import setupPaths from '@/main/paths';
import buildApplicationMenu from '@/main/mainmenu';

Electron.app.setName('Rancher Desktop');

const console = Logging.background;
// If/when we support more than one image processor this will be a pref with a watcher
// for changes, but it's fine as a constant now.
const ImageProviderName: ImageProcessorName = 'nerdctl';

const k8smanager = newK8sManager();
let imageProcessor: ImageProcessor;

setupPaths();

let cfg: settings.Settings;
let gone = false; // when true indicates app is shutting down

// Latch that is set when the app:// protocol handler has been registered.
// This is used to ensure that we don't attempt to open the window before we've
// done that, when the user attempts to open a second instance of the window.
const protocolRegistered = new Latch();

if (!Electron.app.requestSingleInstanceLock()) {
  gone = true;
  process.exit(201);
}

// Scheme must be registered before the app is ready
Electron.protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true } },
]);

process.on('unhandledRejection', (reason: any, promise: any) => {
  if (reason.code === 'ECONNREFUSED' && reason.port === cfg.kubernetes.port) {
    // Do nothing: a connection to the kubernetes server was broken
  } else {
    console.error('UnhandledRejectionWarning:', reason);
  }
});

Electron.app.whenReady().then(async() => {
  try {
    setupNetworking();
    cfg = settings.init();

    // Set up the updater; we may need to quit the app if an update is already
    // queued.
    if (await setupUpdate(cfg, true)) {
      gone = true;
      // The update code will trigger a restart; don't do it here, as it may not
      // be ready yet.
      console.log('Will apply update; skipping startup.');

      return;
    }

    installDevtools();
    setupProtocolHandler();
    await doFirstRun();

    if (gone) {
      console.log('User triggered quit during first-run');

      return;
    }

    buildApplicationMenu();

    Electron.app.setAboutPanelOptions({
      copyright:          'Copyright © 2021 SUSE LLC', // TODO: Update this to 2021-... as dev progresses
      applicationName:    Electron.app.name,
      applicationVersion: `Version ${ await getVersion() }`,
      iconPath:           resources.get('icons', 'logo-square-512.png'),
    });

    setupTray();
    window.openPreferences();

    await startBackend(cfg);
  } catch (ex) {
    console.error('Error starting up:', ex);
    gone = true;
    Electron.app.quit();
  }
});

function installDevtools() {
  if (Electron.app.isPackaged) {
    return;
  }

  const { default: installExtension, VUEJS_DEVTOOLS } = require('electron-devtools-installer');

  // No need to wait for it to complete.
  installExtension(VUEJS_DEVTOOLS);
}

async function doFirstRun() {
  if (!settings.isFirstRun()) {
    return;
  }
  await window.openFirstRun();
  if (os.platform() === 'darwin' || os.platform() === 'linux') {
    await Promise.all([
      linkResource('helm', true),
      linkResource('kim', true), // TODO: Remove when we stop shipping kim
      linkResource('kubectl', true),
      linkResource('nerdctl', true),
    ]);
  }
}

/**
 * Check if there are any reasons that would mean it makes no sense to continue
 * starting the app.  Should be invoked before attempting to start the backend.
 */
async function checkBackendValid() {
  const invalidReason = await k8smanager.getBackendInvalidReason();

  if (invalidReason) {
    handleFailure(invalidReason);
    gone = true;
    Electron.app.quit();
  }
}

/**
 * Set up protocol handler for app://
 * This is needed because in packaged builds we'll not be allowed to access
 * file:// URLs for our resources.
 */
function setupProtocolHandler() {
  Electron.protocol.registerFileProtocol('app', (request, callback) => {
    let relPath = (new URL(request.url)).pathname;

    relPath = decodeURI(relPath); // Needed in case URL contains spaces
    // Default to the path for development mode, running out of the source tree.
    const result: Electron.ProtocolResponse = { path: path.join(Electron.app.getAppPath(), 'dist', 'app', relPath) };
    const mimeTypeMap: Record<string, string> = {
      css:  'text/css',
      html: 'text/html',
      js:   'text/javascript',
      json: 'application/json',
      png:  'image/png',
      svg:  'image/svg+xml',
    };
    const mimeType = mimeTypeMap[path.extname(relPath).toLowerCase().replace(/^\./, '')];

    if (mimeType !== undefined) {
      result.mimeType = mimeType;
    }
    callback(result);
  });
  protocolRegistered.resolve();
}

/**
 * Start the Kubernetes backend.
 *
 * @precondition cfg.kubernetes.version is set.
 */
async function startBackend(cfg: settings.Settings) {
  await checkBackendValid();

  k8smanager.start(cfg.kubernetes).catch(handleFailure);
  imageProcessor = setupImageProcessor(ImageProviderName, k8smanager);
  imageProcessor.namespace = cfg.images.namespace;
}

Electron.app.on('second-instance', async() => {
  // Someone tried to run another instance of Rancher Desktop,
  // reveal and focus this window instead.
  await protocolRegistered;
  window.openPreferences();
});

Electron.app.on('before-quit', async(event) => {
  if (gone) {
    return;
  }
  event.preventDefault();

  try {
    await k8smanager?.stop();

    console.log(`2: Child exited cleanly.`);
  } catch (ex) {
    console.log(`2: Child exited with code ${ ex.errCode }`);
    handleFailure(ex);
  } finally {
    gone = true;
    if (process.env['APPIMAGE']) {
      // For AppImage these links are only valid for this specific runtime,
      // clear broken links before leaving
      await Promise.all([
        linkResource('helm', false),
        linkResource('kim', false), // TODO: Remove when we stop shipping kim
        linkResource('kubectl', false),
        linkResource('nerdctl', false),
      ]);
    }
    Electron.app.quit();
  }
});

Electron.app.on('window-all-closed', () => {
  // On macOS, hide the dock icon.
  Electron.app.dock?.hide();
  // On windows and macOS platforms, we only quit via the notification tray / menu bar.
  // On Linux we close the application since not all distros support tray menu/icons
  if (os.platform() === 'linux' && !settings.isFirstRun()) {
    Electron.app.quit();
  }
});

Electron.app.on('activate', async() => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  await protocolRegistered;
  window.openPreferences();
});

Electron.ipcMain.handle('settings-read', () => {
  return cfg;
});

// This is the synchronous version of the above; we still use
// ipcRenderer.sendSync in some places, so it's required for now.
Electron.ipcMain.on('settings-read', (event) => {
  event.returnValue = cfg;
});

async function relayImageProcessorNamespaces() {
  try {
    const namespaces = await imageProcessor.getNamespaces();
    const comparator = Intl.Collator(undefined, { sensitivity: 'base' }).compare;

    if (!namespaces.includes('default')) {
      namespaces.push('default');
    }
    window.send('images-namespaces', namespaces.sort(comparator));
  } catch (err) {
    console.log('Error getting image namespaces:', err);
  }
}

Electron.ipcMain.on('images-namespaces-read', (event) => {
  if (k8smanager.state === K8s.State.STARTED) {
    relayImageProcessorNamespaces().catch();
  }
});

// Partial<T> (https://www.typescriptlang.org/docs/handbook/utility-types.html#partialtype)
// only allows missing properties on the top level; if anything is given, then all
// properties of that top-level property must exist.  RecursivePartial<T> instead
// allows any decendent properties to be omitted.
type RecursivePartial<T> = {
  [P in keyof T]?:
  T[P] extends (infer U)[] ? RecursivePartial<U>[] :
  // eslint-disable-next-line @typescript-eslint/ban-types
  T[P] extends object ? RecursivePartial<T[P]> :
  T[P];
}

function writeSettings(arg: RecursivePartial<settings.Settings>) {
  _.merge(cfg, arg);
  settings.save(cfg);
  mainEvents.emit('settings-update', cfg);

  Electron.ipcMain.emit('k8s-restart-required');
  if (imageProcessor && imageProcessor.namespace !== cfg.images.namespace) {
    imageProcessor.namespace = cfg.images.namespace;
    imageProcessor.refreshImages().catch((err: Error) => {
      console.log(`Error refreshing images:`, err);
    });
  }
}

Electron.ipcMain.handle('settings-write', (event, arg) => {
  writeSettings(arg);
  event.sender.sendToFrame(event.frameId, 'settings-update', cfg);
});

Electron.ipcMain.on('k8s-state', (event) => {
  event.returnValue = k8smanager.state;
});

Electron.ipcMain.on('k8s-current-port', () => {
  console.log(`k8s-current-port: ${ k8smanager.desiredPort }`);

  window.send('k8s-current-port', k8smanager.desiredPort);
});

Electron.ipcMain.on('k8s-reset', async(_, arg) => {
  await doK8sReset(arg);
});

async function doK8sReset(arg: 'fast' | 'wipe'): Promise<void> {
  // If not in a place to restart than skip it
  if (![K8s.State.STARTED, K8s.State.STOPPED, K8s.State.ERROR].includes(k8smanager.state)) {
    console.log(`Skipping reset, invalid state ${ k8smanager.state }`);

    return;
  }

  try {
    switch (arg) {
    case 'fast':
      await k8smanager.reset(cfg.kubernetes);
      break;
    case 'wipe':
      await k8smanager.stop();

      console.log(`Stopped Kubernetes backened cleanly.`);
      console.log('Deleting VM to reset...');
      await k8smanager.del();
      console.log(`Deleted VM to reset exited cleanly.`);

      await k8smanager.start(cfg.kubernetes);
      break;
    }
  } catch (ex) {
    handleFailure(ex);
  }
}

Electron.ipcMain.on('k8s-restart-required', async() => {
  const restartRequired = (await k8smanager?.requiresRestartReasons()) ?? {};

  window.send('k8s-restart-required', restartRequired);
});

Electron.ipcMain.on('k8s-restart', async() => {
  if (cfg.kubernetes.port !== k8smanager.desiredPort) {
    // On port change, we need to wipe the VM.
    return doK8sReset('wipe');
  }
  try {
    switch (k8smanager.state) {
    case K8s.State.STOPPED:
    case K8s.State.STARTED:
      // Calling start() will restart the backend, possible switching versions
      // as a side-effect.
      await k8smanager.start(cfg.kubernetes);
      break;
    }
  } catch (ex) {
    handleFailure(ex);
  }
});

Electron.ipcMain.on('k8s-versions', async() => {
  window.send('k8s-versions', await k8smanager.availableVersions);
});

Electron.ipcMain.on('k8s-progress', () => {
  window.send('k8s-progress', k8smanager.progress);
});

Electron.ipcMain.handle('k8s-supports-port-forwarding', () => {
  return !!k8smanager.portForwarder;
});

Electron.ipcMain.handle('service-fetch', (event, namespace) => {
  return k8smanager.listServices(namespace);
});

Electron.ipcMain.handle('service-forward', async(event, service, state) => {
  const forwarder = k8smanager?.portForwarder;

  if (forwarder) {
    if (state) {
      await forwarder.forwardPort(service.namespace, service.name, service.port);
    } else {
      await forwarder.cancelForward(service.namespace, service.name, service.port);
    }
  }
});

Electron.ipcMain.on('k8s-integrations', async(event) => {
  event.reply('k8s-integrations', await k8smanager?.listIntegrations());
});

Electron.ipcMain.on('k8s-integration-set', async(event, name, newState) => {
  console.log(`Setting k8s integration for ${ name } to ${ newState }`);
  if (!k8smanager) {
    return;
  }
  const currentState = await k8smanager.listIntegrations();

  if (!(name in currentState) || currentState[name] === newState) {
    event.reply('k8s-integrations', currentState);

    return;
  }
  if (typeof currentState[name] === 'string') {
    // There is an error, and we cannot set the integration
    event.reply('k8s-integrations', currentState);

    return;
  }
  const error = await k8smanager.setIntegration(name, newState);

  if (error) {
    currentState[name] = error;
    event.reply('k8s-integrations', currentState);
  } else {
    event.reply('k8s-integrations', await k8smanager.listIntegrations());
  }
});

Electron.ipcMain.on('k8s-integration-warnings', () => {
  k8smanager.listIntegrationWarnings();
});

/**
 * Do a factory reset of the application.  This will stop the currently running
 * cluster (if any), and delete all of its data.  This will also remove any
 * rancher-desktop data, and restart the application.
 */
Electron.ipcMain.on('factory-reset', async() => {
  // Clean up the Kubernetes cluster
  await k8smanager.factoryReset();
  if (os.platform() === 'darwin') {
    // Unlink binaries
    for (const name of ['helm', 'kim', 'kubectl', 'nerdctl']) {
      Electron.ipcMain.emit('install-set', { reply: () => { } }, name, false);
    }
  }
  // Remove app settings
  await settings.clear();
  // Restart
  Electron.app.relaunch();
  Electron.app.quit();
});

Electron.ipcMain.on('troubleshooting/show-logs', async(event) => {
  const error = await Electron.shell.openPath(paths.logs);

  if (error) {
    const browserWindow = Electron.BrowserWindow.fromWebContents(event.sender);
    const options = {
      message: error,
      type:    'error',
      title:   `Error opening logs`,
      detail:  `Please manually open ${ paths.logs }`,
    };

    console.error(`Failed to open logs: ${ error }`);
    if (browserWindow) {
      await Electron.dialog.showMessageBox(browserWindow, options);
    } else {
      await Electron.dialog.showMessageBox(options);
    }
  }
});

Electron.ipcMain.handle('get-app-version', async(event) => {
  return await getVersion();
});

Electron.ipcMain.handle('show-message-box', (event, options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> => {
  return Electron.dialog.showMessageBox(options);
});

function getProductionVersion() {
  try {
    return Electron.app.getVersion();
  } catch (err) {
    console.log(`Can't get app version: ${ err }`);

    return '?';
  }
}

async function getDevVersion() {
  try {
    const { stdout } = await childProcess.spawnFile('git', ['describe', '--tags'], { stdio: ['ignore', 'pipe', 'inherit'] });

    return stdout.trim();
  } catch (err) {
    console.log(`Can't get app version: ${ err }`);

    return '?';
  }
}

async function getVersion() {
  return process.env.NODE_ENV === 'production' ? getProductionVersion() : await getDevVersion();
}

/**
 * assume sync activities aren't going to be costly for a UI app.
 * @param name -- basename of the resource to link
 * @param state -- true to symlink, false to delete
 */
async function linkResource(name: string, state: boolean): Promise<Error | null> {
  const linkPath = path.join(paths.integration, name);

  let err: Error | null = await new Promise((resolve) => {
    fs.mkdir(paths.integration, { recursive: true }, resolve);
  });

  if (err) {
    console.error(`Error creating the directory ${ paths.integration }: ${ err.message }`);

    return err;
  }

  if (state) {
    err = await new Promise((resolve) => {
      fs.symlink(resources.executable(name), linkPath, 'file', resolve);
    });

    if (err) {
      console.error(`Error creating symlink for ${ linkPath }: ${ err.message }`);

      return err;
    }
  } else {
    err = await new Promise((resolve) => {
      fs.unlink(linkPath, resolve);
    });

    if (err) {
      console.error(`Error unlinking symlink for ${ linkPath }: ${ err.message }`);

      return err;
    }
  }

  return null;
}

function handleFailure(payload: any) {
  let titlePart = 'Starting Kubernetes';
  let message = 'There was an unknown error starting Kubernetes';

  if (payload instanceof K8s.KubernetesError) {
    ({ name: titlePart, message } = payload);
  } else if (payload instanceof Error) {
    message += `: ${ payload }`;
  } else if (typeof payload === 'number') {
    message = `Kubernetes was unable to start with the following exit code: ${ payload }`;
  } else if ('errorCode' in payload) {
    message = payload.message || message;
    titlePart = payload.context || titlePart;
  }
  console.log(`Kubernetes was unable to start:`, payload);
  Electron.dialog.showErrorBox(`Error ${ titlePart }`, message);
}

function newK8sManager() {
  const mgr = K8s.factory();

  mgr.on('state-changed', (state: K8s.State) => {
    mainEvents.emit('k8s-check-state', mgr);
    window.send('k8s-check-state', state);
    if (state === K8s.State.STARTED) {
      if (!cfg.kubernetes.version) {
        writeSettings({ kubernetes: { version: mgr.version } });
      }
      relayImageProcessorNamespaces().catch();
    }
  });

  mgr.on('current-port-changed', (port: number) => {
    window.send('k8s-current-port', port);
  });

  mgr.on('service-changed', (services: K8s.ServiceEntry[]) => {
    window.send('service-changed', services);
  });

  mgr.on('progress', () => {
    window.send('k8s-progress', mgr.progress);
  });

  mgr.on('versions-updated', async() => {
    window.send('k8s-versions', await mgr.availableVersions);
  });

  return mgr;
}
