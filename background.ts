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
import { RecursivePartial } from '@/utils/typeUtils';
import { closeDashboard, openDashboard } from '@/window/dashboard';
import * as K8s from '@/k8s-engine/k8s';
import Logging, { setLogLevel } from '@/utils/logging';
import * as childProcess from '@/utils/childProcess';
import Latch from '@/utils/latch';
import paths from '@/utils/paths';
import { CommandWorkerInterface, HttpCommandServer } from '@/main/commandServer/httpCommandServer';
import setupNetworking from '@/main/networking';
import setupUpdate from '@/main/update';
import setupTray from '@/main/tray';
import buildApplicationMenu from '@/main/mainmenu';
import { Steve } from '@/k8s-engine/steve';
import SettingsValidator from '@/main/commandServer/settingsValidator';
import { getPathManagerFor, PathManagementStrategy, PathManager } from '@/integrations/pathManager';
import { IntegrationManager, getIntegrationManager } from '@/integrations/integrationManager';
import removeLegacySymlinks from '@/integrations/legacy';

Electron.app.setName('Rancher Desktop');
Electron.app.setPath('cache', paths.cache);
Electron.app.setAppLogsPath(paths.logs);

const console = Logging.background;

const k8smanager = newK8sManager();

let cfg: settings.Settings;
let gone = false; // when true indicates app is shutting down
let imageEventHandler: ImageEventHandler|null = null;
let currentContainerEngine = settings.ContainerEngine.NONE;
let currentImageProcessor: ImageProcessor | null = null;
let enabledK8s: boolean;
let pathManager: PathManager;
const integrationManager: IntegrationManager = getIntegrationManager();

/**
 * pendingRestart is needed because with the CLI it's possible to change the state of the
 * system without using the UI. This can push the system out of sync, for example setting
 * kubernetes-enabled=true while it's disabled. Normally the code restart the system
 * when processing the SET command, but if the backend is currently starting up or shutting down,
 * we have to wait for it to finish. This module gets a `state-changed` event when that happens,
 * and if this flag is true, a new restart can be triggered.
 */
let pendingRestart = false;

// Latch that is set when the app:// protocol handler has been registered.
// This is used to ensure that we don't attempt to open the window before we've
// done that, when the user attempts to open a second instance of the window.
const protocolRegistered = Latch();

let httpCommandServer: HttpCommandServer|null = null;

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
mainEvents.on('settings-update', async(newSettings) => {
  if (newSettings.debug) {
    setLogLevel('debug');
  } else {
    setLogLevel('info');
  }
  k8smanager.debug = newSettings.debug;

  if (pathManager.strategy !== newSettings.pathManagementStrategy) {
    await pathManager.remove();
    pathManager = getPathManagerFor(newSettings.pathManagementStrategy);
    await pathManager.enforce();
  }
});

Electron.app.whenReady().then(async() => {
  try {
    httpCommandServer = new HttpCommandServer(new BackgroundCommandWorker());
    await httpCommandServer.init();
    await setupNetworking();
    cfg = settings.init();
    pathManager = getPathManagerFor(cfg.pathManagementStrategy);
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
    if (os.platform() === 'linux') {
      await removeLegacySymlinks(paths.oldIntegration);
    }
    await integrationManager.enforce();
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
      iconPath:           path.join(paths.resources, 'icons', 'logo-square-512.png'),
    });

    setupTray();
    window.openPreferences();

    // Path management strategy will need to be selected after an upgrade
    if (!os.platform().startsWith('win') && cfg.pathManagementStrategy === PathManagementStrategy.NotSet) {
      await window.openPathUpdate();
    }

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
  enabledK8s = cfg.kubernetes.enabled;

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
  httpCommandServer?.closeServer();
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
      await integrationManager.removeSymlinksOnly();
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

Electron.ipcMain.on('dashboard-open', () => {
  openDashboard();
});

Electron.ipcMain.on('dashboard-close', () => {
  closeDashboard();
});

function writeSettings(arg: RecursivePartial<settings.Settings>) {
  _.merge(cfg, arg);
  settings.save(cfg);
  mainEvents.emit('settings-update', cfg);
  Electron.ipcMain.emit('k8s-restart-required');
}

Electron.ipcMain.handle('settings-write', (event, arg) => {
  console.debug(`event settings-write in main: ${ event }, ${ arg }`);
  writeSettings(arg);

  // dashboard requires kubernetes, so we want to close it if kubernetes is disabled
  if (arg?.kubernetes?.enabled === false) {
    closeDashboard();
  }

  event.sender.sendToFrame(event.frameId, 'settings-update', cfg);
});

mainEvents.on('settings-write', writeSettings);

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

function backendIsBusy() {
  return [K8s.State.STARTING, K8s.State.STOPPING].includes(k8smanager.state);
}

async function doK8sReset(arg: 'fast' | 'wipe' | 'fullRestart'): Promise<void> {
  // If not in a place to restart than skip it
  if (backendIsBusy()) {
    console.log(`Skipping reset, invalid state ${ k8smanager.state }`);

    return;
  }

  try {
    switch (arg) {
    case 'fast':
      await k8smanager.reset(cfg.kubernetes);
      break;
    case 'fullRestart':
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
  } else if (cfg.kubernetes.containerEngine !== currentContainerEngine || cfg.kubernetes.enabled !== enabledK8s) {
    return doK8sReset('fullRestart');
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

/**
 * Do a factory reset of the application.  This will stop the currently running
 * cluster (if any), and delete all of its data.  This will also remove any
 * rancher-desktop data, and restart the application.
 */
Electron.ipcMain.on('factory-reset', async() => {
  await k8smanager.factoryReset();
  await pathManager.remove();
  await integrationManager.remove();
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
    childProcess.spawn(path.join(paths.resources, 'win32', 'wsl-helper.exe'),
      ['factory-reset', `--wait-pid=${ process.pid }`, `--launch=${ process.argv0 }`],
      { detached: true, windowsHide: true });
    Electron.app.quit();

    return;
  }
  // Remove app settings
  await settings.clear();

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
    // getFailureDetails is going to read from existing log files.
    // Wait 1 second before reading them to allow recent writes to appear in them.
    await util.promisify(setTimeout)(1_000);
    const failureDetails: K8s.FailureDetails = await k8smanager.getFailureDetails(payload);

    if (failureDetails) {
      await window.openKubernetesErrorMessageWindow(titlePart, secondaryMessage || message, failureDetails);

      return;
    }
  } catch (e) {
    console.log(`Failed to get failure details: `, e);
  }
  showErrorDialog(titlePart, message, payload instanceof K8s.KubernetesError && payload.fatal).catch();
}

mainEvents.on('handle-failure', showErrorDialog);

function doFullRestart() {
  doK8sReset('fullRestart').catch((err: any) => {
    console.log(`Error restarting: ${ err }`);
  });
}

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
      // TODO: Find the appropriate location to start the Steve API

      if (enabledK8s) {
        Steve.getInstance().start();
      }
    }

    if (state === K8s.State.STOPPING) {
      Steve.getInstance().stop();
    }
    if (pendingRestart && !backendIsBusy()) {
      pendingRestart = false;
      // If we restart immediately the QEMU process in the VM doesn't always respond to a shutdown messages
      setTimeout(doFullRestart, 2_000);
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

/**
 * Implement the methods the HttpCommandServer needs to service its requests.
 * These methods do two things:
 * 1. Verify the semantics of the parameters (the server just checks syntax).
 * 2. Provide a thin wrapper over existing functionality in this module.
 * Getters, on success, return status 200 and a string that may be JSON or simple.
 * Setters, on success, return status 202, possibly with a human-readable status note.
 * The `requestShutdown` method is a special case that never returns.
 */
class BackgroundCommandWorker implements CommandWorkerInterface {
  protected k8sVersions: string[] = [];
  protected settingsValidator = new SettingsValidator();

  getSettings() {
    return JSON.stringify(cfg, undefined, 2);
  }

  /**
   * Check semantics of SET commands:
   * - verify that setting names are recognized, and validate provided values
   * - returns an array of two strings:
   *   1. a description of the status of the request, if it was valid
   *   2. a list of any errors in the request body.
   * @param newSettings: a subset of the Settings object, containing the desired values
   * @returns [{string} description of final state if no error, {string} error message]
   */
  async updateSettings(newSettings: Record<string, any>): Promise<[string, string]> {
    if (this.k8sVersions.length === 0) {
      this.k8sVersions = (await k8smanager.availableVersions).map(entry => entry.version.version);
      this.settingsValidator.k8sVersions = this.k8sVersions;
    }
    const [needToUpdate, errors] = this.settingsValidator.validateSettings(cfg, newSettings);

    if (errors.length > 0) {
      return ['', `errors in attempt to update settings:\n${ errors.join('\n') }`];
    }
    if (needToUpdate) {
      writeSettings(newSettings);
      // cfg is a global, and at this point newConfig has been merged into it :(
      window.send('settings-update', cfg);
      if (!backendIsBusy()) {
        pendingRestart = false;
        setImmediate(doFullRestart);

        return ['triggering a restart to apply changes', ''];
      } else {
        // Call doFullRestart once the UI is finished starting or stopping
        pendingRestart = true;

        return ['UI is currently busy, but will eventually restart to apply changes', ''];
      }
    } else {
      return ['no changes necessary', ''];
    }
  }

  async requestShutdown() {
    await k8smanager.stop();
    Electron.app.quit();
  }
}
