import fs from 'fs';
import path from 'path';
import os from 'os';
import util from 'util';
import { URL } from 'url';

import Electron from 'electron';
import _ from 'lodash';

import mainEvents from '@/main/mainEvents';
import { getImageProcessor } from '@/k8s-engine/images/imageFactory';
import { ImageProcessor } from '@/k8s-engine/images/imageProcessor';
import { ImageEventHandler } from '@/main/imageEvents';
import * as settings from '@/config/settings';
import * as window from '@/window';
import * as K8s from '@/k8s-engine/k8s';
import resources from '@/resources';
import Logging, { setLogLevel } from '@/utils/logging';
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

const k8smanager = newK8sManager();

setupPaths();

let cfg: settings.Settings;
let gone = false; // when true indicates app is shutting down
let imageEventHandler: ImageEventHandler|null = null;
let currentContainerEngine = settings.ContainerEngine.NONE;
let currentImageProcessor: ImageProcessor | null = null;

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

// takes care of any propagation of settings we want to do
// when settings change
mainEvents.on('settings-update', (newSettings) => {
  if (newSettings.debug) {
    setLogLevel('debug');
  } else {
    setLogLevel('info');
  }
  k8smanager.debug = newSettings.debug;
});

Electron.app.whenReady().then(async() => {
  try {
    setupNetworking();
    cfg = settings.init();
    mainEvents.emit('settings-update', cfg);

    // Set up the updater; we may need to quit the app if an update is already
    // queued.
    if (await setupUpdate(cfg.updater, true)) {
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
      linkResource('docker', true),
      linkResource('helm', true),
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
    await handleFailure(invalidReason);
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
  try {
    await startK8sManager();
  } catch (err) {
    handleFailure(err);
  }
}

async function startK8sManager() {
  const changedContainerEngine = currentContainerEngine !== cfg.kubernetes.containerEngine;

  currentContainerEngine = cfg.kubernetes.containerEngine;
  if (changedContainerEngine) {
    setupImageProcessor();
  }
  try {
    await k8smanager.start(cfg.kubernetes);
  } catch (err) {
    handleFailure(err);
  }
}

/**
 * We need to deactivate the current imageProcessor, if there is one,
 * so it stops processing events,
 * and also tell the image event-handler about the new image processor.
 *
 * Some container engines support namespaces, so we need to specify the current namespace
 * as well. It should be done here so that the consumers of the `current-engine-changed`
 * event will operate in an environment where the image-processor knows the current namespace.
 */

function setupImageProcessor() {
  const imageProcessor = getImageProcessor(cfg.kubernetes.containerEngine, k8smanager);

  currentImageProcessor?.deactivate();
  if (!imageEventHandler) {
    imageEventHandler = new ImageEventHandler(imageProcessor);
  }
  imageEventHandler.imageProcessor = imageProcessor;
  currentImageProcessor = imageProcessor;
  currentImageProcessor.activate();
  currentImageProcessor.namespace = cfg.images.namespace;
  window.send('k8s-current-engine', cfg.kubernetes.containerEngine);
}

Electron.app.on('second-instance', async() => {
  // Someone tried to run another instance of Rancher Desktop,
  // reveal and focus this window instead.
  await protocolRegistered;
  window.openPreferences();
});

interface K8sError {
  errCode: number | string
}

function isK8sError(object: any): object is K8sError {
  return 'errCode' in object;
}

Electron.app.on('before-quit', async(event) => {
  if (gone) {
    return;
  }
  event.preventDefault();

  try {
    await k8smanager?.stop();

    console.log(`2: Child exited cleanly.`);
  } catch (ex) {
    if (isK8sError(ex)) {
      console.log(`2: Child exited with code ${ ex.errCode }`);
    }
    handleFailure(ex);
  } finally {
    gone = true;
    if (process.env['APPIMAGE']) {
      // For AppImage these links are only valid for this specific runtime,
      // clear broken links before leaving
      await Promise.all([
        linkResource('helm', false),
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

Electron.ipcMain.on('settings-read', (event) => {
  event.reply('settings-read', cfg);
});

// This is the synchronous version of the above; we still use
// ipcRenderer.sendSync in some places, so it's required for now.
Electron.ipcMain.on('settings-read', (event) => {
  console.debug(`event settings-read in main: ${ event }`);
  event.returnValue = cfg;
});

Electron.ipcMain.on('images-namespaces-read', (event) => {
  if (k8smanager.state === K8s.State.STARTED) {
    currentImageProcessor?.relayNamespaces();
  }
});

// Partial<T> (https://www.typescriptlang.org/docs/handbook/utility-types.html#partialtype)
// only allows missing properties on the top level; if anything is given, then all
// properties of that top-level property must exist.  RecursivePartial<T> instead
// allows any descendent properties to be omitted.
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
}

Electron.ipcMain.handle('settings-write', (event, arg) => {
  console.debug(`event settings-write in main: ${ event }, ${ arg }`);
  writeSettings(arg);
  event.sender.sendToFrame(event.frameId, 'settings-update', cfg);
});

Electron.ipcMain.on('k8s-state', (event) => {
  event.returnValue = k8smanager.state;
});

Electron.ipcMain.on('k8s-current-engine', () => {
  window.send('k8s-current-engine', currentContainerEngine);
});

Electron.ipcMain.on('k8s-current-port', () => {
  window.send('k8s-current-port', k8smanager.desiredPort);
});

Electron.ipcMain.on('k8s-reset', async(_, arg) => {
  await doK8sReset(arg);
});

async function doK8sReset(arg: 'fast' | 'wipe' | 'changeEngines'): Promise<void> {
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
    case 'changeEngines':
      await k8smanager.stop();
      console.log(`Stopped Kubernetes backend cleanly.`);
      await startK8sManager();
      break;
    case 'wipe':
      await k8smanager.stop();

      console.log(`Stopped Kubernetes backend cleanly.`);
      console.log('Deleting VM to reset...');
      await k8smanager.del();
      console.log(`Deleted VM to reset exited cleanly.`);

      await startK8sManager();
      break;
    }
  } catch (ex) {
    handleFailure(ex);
  }
}

async function doK8sRestartRequired() {
  const restartRequired = (await k8smanager?.requiresRestartReasons()) ?? {};

  window.send('k8s-restart-required', restartRequired);
}

Electron.ipcMain.on('k8s-restart-required', async() => {
  await doK8sRestartRequired();
});

Electron.ipcMain.on('k8s-restart', async() => {
  if (cfg.kubernetes.port !== k8smanager.desiredPort) {
    // On port change, we need to wipe the VM.
    return doK8sReset('wipe');
  } else if (cfg.kubernetes.containerEngine !== currentContainerEngine) {
    return doK8sReset('changeEngines');
  }
  try {
    switch (k8smanager.state) {
    case K8s.State.STOPPED:
    case K8s.State.STARTED:
      // Calling start() will restart the backend, possible switching versions
      // as a side-effect.
      await startK8sManager();
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
  switch (os.platform()) {
  case 'darwin':
    // Unlink binaries
    for (const name of ['docker', 'helm', 'kubectl', 'nerdctl']) {
      Electron.ipcMain.emit('install-set', { reply: () => { } }, name, false);
    }
    break;
  case 'win32':
    // On Windows, we need to use a helper process in order to ensure we
    // delete files in use.  Of course, we can't wait for that process to
    // return - the whole point is for us to not be running.
    childProcess.spawn(resources.executable('wsl-helper'),
      ['factory-reset', `--wait-pid=${ process.pid }`, `--launch=${ process.argv0 }`],
      { detached: true, windowsHide: true });
    Electron.app.quit();

    return;
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

Electron.ipcMain.on('get-app-version', async(event) => {
  event.reply('get-app-version', await getVersion());
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

async function showErrorDialog(title: string, message: string, fatal?: boolean): Promise<void> {
  await Electron.dialog.showErrorBox(title, message);
  if (fatal) {
    process.exit(0);
  }
}

async function handleFailure(payload: any) {
  let titlePart = 'Error Starting Kubernetes';
  let message = 'There was an unknown error starting Kubernetes';
  let secondaryMessage = '';

  if (payload instanceof K8s.KubernetesError) {
    ({ name: titlePart, message } = payload);
  } else if (payload instanceof Error) {
    secondaryMessage = payload.toString();
  } else if (typeof payload === 'number') {
    message = `Kubernetes was unable to start with the following exit code: ${ payload }`;
  } else if ('errorCode' in payload) {
    message = payload.message || message;
    titlePart = payload.context || titlePart;
  }
  console.log(`Kubernetes was unable to start:`, payload);
  try {
    await util.promisify(setTimeout)(1_000);
    const failureDetails = await k8smanager.getFailureDetails();

    if (failureDetails) {
      if (secondaryMessage) {
        message = secondaryMessage;
      }
      if (failureDetails.lastCommand) {
        message += `\nLast command: ${ failureDetails.lastCommand }`;
      }
      if (failureDetails.lastCommandComment) {
        message += `\nDescription: ${ failureDetails.lastCommandComment }`;
      }
      if (failureDetails.lastLogLines) {
        console.log(`\n${ failureDetails.lastLogLines.join('\n') }`);
        message += `\nLast Log Lines: ${ failureDetails.lastLogLines.join('\n') }`;
      }
      await window.openKubernetesErrorMessageWindow(titlePart, secondaryMessage || message, failureDetails.lastCommand, failureDetails.lastCommandComment, failureDetails.lastLogLines);

      return;
    }
  } catch (e) {
    console.log(`Failed to get failure details: `, e);
  }
  showErrorDialog(titlePart, message, payload instanceof K8s.KubernetesError && payload.fatal).catch();
}

mainEvents.on('handle-failure', showErrorDialog);

function newK8sManager() {
  const arch = (Electron.app.runningUnderARM64Translation || os.arch() === 'arm64') ? 'aarch64' : 'x86_64';
  const mgr = K8s.factory(arch);

  mgr.on('state-changed', (state: K8s.State) => {
    mainEvents.emit('k8s-check-state', mgr);
    window.send('k8s-check-state', state);
    if (state === K8s.State.STARTED) {
      if (!cfg.kubernetes.version) {
        writeSettings({ kubernetes: { version: mgr.version } });
      }
      currentImageProcessor?.relayNamespaces();
    }
  });

  mgr.on('current-port-changed', (port: number) => {
    window.send('k8s-current-port', port);
  });

  mgr.on('kim-builder-uninstalled', () => {
    writeSettings({ kubernetes: { checkForExistingKimBuilder: false } });
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

  mgr.on('show-notification', (notificationOptions: Electron.NotificationConstructorOptions) => {
    (new Electron.Notification(notificationOptions)).show();
  });

  return mgr;
}
