import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import util from 'util';

import Electron from 'electron';
import _ from 'lodash';

import BackendHelper from '@pkg/backend/backendHelper';
import K8sFactory from '@pkg/backend/factory';
import { getImageProcessor } from '@pkg/backend/images/imageFactory';
import { ImageProcessor } from '@pkg/backend/images/imageProcessor';
import * as K8s from '@pkg/backend/k8s';
import { Steve } from '@pkg/backend/steve';
import { Help } from '@pkg/config/help';
import * as settings from '@pkg/config/settings';
import { TransientSettings } from '@pkg/config/transientSettings';
import { IntegrationManager, getIntegrationManager } from '@pkg/integrations/integrationManager';
import { removeLegacySymlinks, PermissionError } from '@pkg/integrations/legacy';
import { getPathManagerFor, PathManagementStrategy, PathManager } from '@pkg/integrations/pathManager';
import { CommandWorkerInterface, HttpCommandServer } from '@pkg/main/commandServer/httpCommandServer';
import SettingsValidator from '@pkg/main/commandServer/settingsValidator';
import { HttpCredentialHelperServer } from '@pkg/main/credentialServer/httpCredentialHelperServer';
import { DashboardServer } from '@pkg/main/dashboardServer';
import { DiagnosticsManager, DiagnosticsResultCollection } from '@pkg/main/diagnostics/diagnostics';
import { ImageEventHandler } from '@pkg/main/imageEvents';
import { getIpcMainProxy } from '@pkg/main/ipcMain';
import mainEvents from '@pkg/main/mainEvents';
import buildApplicationMenu from '@pkg/main/mainmenu';
import setupNetworking from '@pkg/main/networking';
import setupTray from '@pkg/main/tray';
import setupUpdate from '@pkg/main/update';
import getCommandLineArgs from '@pkg/utils/commandLine';
import DockerDirManager from '@pkg/utils/dockerDirManager';
import { arrayCustomizer } from '@pkg/utils/filters';
import Logging, { setLogLevel, clearLoggingDirectory } from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';
import { setupProtocolHandler, protocolRegistered } from '@pkg/utils/protocols';
import { jsonStringifyWithWhiteSpace } from '@pkg/utils/stringify';
import { RecursivePartial } from '@pkg/utils/typeUtils';
import { getVersion } from '@pkg/utils/version';
import * as window from '@pkg/window';
import { closeDashboard, openDashboard } from '@pkg/window/dashboard';
import { preferencesSetDirtyFlag } from '@pkg/window/preferences';

Electron.app.setPath('cache', paths.cache);
Electron.app.setAppLogsPath(paths.logs);

const console = Logging.background;

if (!Electron.app.requestSingleInstanceLock()) {
  process.exit(201);
}

clearLoggingDirectory();

const ipcMainProxy = getIpcMainProxy(console);
const dockerDirManager = new DockerDirManager(path.join(os.homedir(), '.docker'));
const k8smanager = newK8sManager();
const diagnostics: DiagnosticsManager = new DiagnosticsManager();

let cfg: settings.Settings;
let firstRunDialogComplete = false;
let gone = false; // when true indicates app is shutting down
let imageEventHandler: ImageEventHandler|null = null;
let currentContainerEngine = settings.ContainerEngine.NONE;
let currentImageProcessor: ImageProcessor | null = null;
let enabledK8s: boolean;
let pathManager: PathManager;
const integrationManager: IntegrationManager = getIntegrationManager();
let noModalDialogs = false;

/**
 * pendingRestartContext is needed because with the CLI it's possible to change
 * the state of the system without using the UI.  This can push the system out
 * of sync, for example setting kubernetes-enabled=true while it's disabled.
 * Normally the code restarts the system when processing the SET command, but if
 * the backend is currently starting up or shutting down, we have to wait for it
 * to finish.  This module gets a `state-changed` event when that happens,
 * and if this flag is true, a new restart can be triggered.
 */
let pendingRestartContext: CommandWorkerInterface.CommandContext | undefined;

let httpCommandServer: HttpCommandServer|null = null;
const httpCredentialHelperServer = new HttpCredentialHelperServer();

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

Electron.app.on('second-instance', async() => {
  await protocolRegistered;
  console.warn('A second instance was started');
  if (firstRunDialogComplete) {
    window.openMain();
  }
});

// takes care of any propagation of settings we want to do
// when settings change
mainEvents.on('settings-update', async(newSettings) => {
  console.log(`mainEvents settings-update: ${ JSON.stringify(newSettings) }`);
  const runInDebugMode = settings.runInDebugMode(newSettings.debug);

  if (runInDebugMode) {
    setLogLevel('debug');
  } else {
    setLogLevel('info');
  }
  k8smanager.debug = runInDebugMode;

  if (pathManager.strategy !== newSettings.pathManagementStrategy) {
    await pathManager.remove();
    pathManager = getPathManagerFor(newSettings.pathManagementStrategy);
    await pathManager.enforce();
  }
});

mainEvents.handle('settings-fetch', () => {
  return Promise.resolve(cfg);
});

Electron.app.whenReady().then(async() => {
  try {
    const commandLineArgs = getCommandLineArgs();

    installDevtools();
    setupProtocolHandler();

    // Needs to happen before any file is written, otherwise that file
    // could be owned by root, which will lead to future problems.
    if (['linux', 'darwin'].includes(os.platform())) {
      await checkForRootPrivs();
    }

    DashboardServer.getInstance().init();
    httpCommandServer = new HttpCommandServer(new BackgroundCommandWorker());
    await httpCommandServer.init();
    await httpCredentialHelperServer.init();
    await setupNetworking();
    cfg = settings.load();

    if (commandLineArgs.length) {
      try {
        cfg = settings.updateFromCommandLine(cfg, commandLineArgs);
        k8smanager.noModalDialogs = noModalDialogs = TransientSettings.value.noModalDialogs;
      } catch (err) {
        console.log(`Failed to update command from argument ${ commandLineArgs } `, err);
      }
    }
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

    await integrationManager.enforce();
    await doFirstRunDialog();

    if (gone) {
      console.log('User triggered quit during first-run');

      return;
    }

    buildApplicationMenu();

    Electron.app.setAboutPanelOptions({
      copyright:          'Copyright © 2021-2022 SUSE LLC', // TODO: Update this to 2021-... as dev progresses
      applicationName:    Electron.app.name,
      applicationVersion: `Version ${ await getVersion() }`,
      iconPath:           path.join(paths.resources, 'icons', 'logo-square-512.png'),
    });

    setupTray();
    window.openMain();

    dockerDirManager.ensureCredHelperConfigured();

    // Path management strategy will need to be selected after an upgrade
    if (!os.platform().startsWith('win') && cfg.pathManagementStrategy === PathManagementStrategy.NotSet) {
      if (!noModalDialogs) {
        await window.openPathUpdate();
      } else {
        cfg.pathManagementStrategy = PathManagementStrategy.RcFiles;
      }
    }

    if (os.platform() === 'linux' || os.platform() === 'darwin') {
      try {
        await removeLegacySymlinks(paths.oldIntegration);
      } catch (error) {
        if (error instanceof PermissionError) {
          await window.openLegacyIntegrations();
        } else {
          throw error;
        }
      }
    }

    diagnostics.runChecks().catch(console.error);

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

  // No need to wait for it to complete, but handle any errors asynchronously
  installExtension(VUEJS_DEVTOOLS).catch((err: any) => {
    console.log(`Error installing VUEJS_DEVTOOLS: ${ err }`);
  });
}

async function doFirstRunDialog() {
  if (settings.firstRunDialogNeeded()) {
    await window.openFirstRunDialog();
  }
  firstRunDialogComplete = true;
}

async function checkForRootPrivs() {
  if (isRoot()) {
    await window.openDenyRootDialog();
    gone = true;
    Electron.app.quit();
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

/**
 * Start the backend.
 *
 * @note Callers are responsible for handling errors thrown from here.
 */
async function startK8sManager() {
  const changedContainerEngine = currentContainerEngine !== cfg.kubernetes.containerEngine;

  currentContainerEngine = cfg.kubernetes.containerEngine;
  enabledK8s = cfg.kubernetes.enabled;

  if (changedContainerEngine) {
    setupImageProcessor();
  }
  await k8smanager.start(cfg);
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
  const imageProcessor = getImageProcessor(cfg.kubernetes.containerEngine, k8smanager.executor);

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

interface K8sError {
  errCode: number | string
}

function isK8sError(object: any): object is K8sError {
  return 'errCode' in object;
}

Electron.app.on('before-quit', async(event) => {
  if (gone) {
    mainEvents.emit('quit');

    return;
  }
  event.preventDefault();
  httpCommandServer?.closeServer();
  httpCredentialHelperServer.closeServer();

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
});

Electron.app.on('activate', async() => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (!firstRunDialogComplete) {
    console.log('Still processing the first-run dialog: not opening main window');

    return;
  }
  await protocolRegistered;
  window.openMain();
});

ipcMainProxy.on('settings-read', (event) => {
  event.reply('settings-read', cfg);
});

// This is the synchronous version of the above; we still use
// ipcRenderer.sendSync in some places, so it's required for now.
ipcMainProxy.on('settings-read', (event) => {
  console.debug(`event settings-read in main: ${ JSON.stringify(cfg) }`);
  event.returnValue = cfg;
});

ipcMainProxy.on('images-namespaces-read', (event) => {
  if ([K8s.State.STARTED, K8s.State.DISABLED].includes(k8smanager.state)) {
    currentImageProcessor?.relayNamespaces();
  }
});

ipcMainProxy.on('dashboard-open', () => {
  openDashboard();
});

ipcMainProxy.on('dashboard-close', () => {
  closeDashboard();
});

ipcMainProxy.on('preferences-open', () => {
  window.openMain(true);
});

ipcMainProxy.on('preferences-close', () => {
  window.getWindow('preferences')?.close();
});

ipcMainProxy.on('preferences-set-dirty', (_event, dirtyFlag) => {
  preferencesSetDirtyFlag(dirtyFlag);
});

function writeSettings(arg: RecursivePartial<settings.Settings>) {
  // arrayCustomizer is necessary to properly merge array of strings
  _.mergeWith(cfg, arg, arrayCustomizer);
  settings.save(cfg);
  mainEvents.emit('settings-update', cfg);
}

ipcMainProxy.handle('settings-write', (event, arg) => {
  writeSettings(arg);

  // dashboard requires kubernetes, so we want to close it if kubernetes is disabled
  if (arg?.kubernetes?.enabled === false) {
    closeDashboard();
  }

  event.sender.sendToFrame(event.frameId, 'settings-update', cfg);
});

mainEvents.on('settings-write', writeSettings);

ipcMainProxy.handle('transient-settings-fetch', () => {
  return Promise.resolve(TransientSettings.value);
});

ipcMainProxy.handle('transient-settings-update', (event, arg) => {
  TransientSettings.update(arg);
});

ipcMainProxy.on('k8s-state', (event) => {
  event.returnValue = k8smanager.state;
});

ipcMainProxy.on('k8s-current-engine', () => {
  window.send('k8s-current-engine', currentContainerEngine);
});

ipcMainProxy.on('k8s-current-port', () => {
  window.send('k8s-current-port', k8smanager.kubeBackend.desiredPort);
});

ipcMainProxy.on('k8s-reset', async(_, arg) => {
  await doK8sReset(arg, { interactive: true });
});

ipcMainProxy.on('api-get-credentials', () => {
  mainEvents.emit('api-get-credentials');
});

Electron.ipcMain.handle('api-get-credentials', () => {
  return new Promise<void>((resolve) => {
    mainEvents.once('api-credentials', resolve);
    mainEvents.emit('api-get-credentials');
  });
});

mainEvents.on('api-credentials', (credentials) => {
  window.send('api-credentials', credentials);
});

function backendIsBusy() {
  return [K8s.State.STARTING, K8s.State.STOPPING].includes(k8smanager.state);
}

async function doK8sReset(arg: 'fast' | 'wipe' | 'fullRestart', context: CommandWorkerInterface.CommandContext): Promise<void> {
  // If not in a place to restart than skip it
  if (backendIsBusy()) {
    console.log(`Skipping reset, invalid state ${ k8smanager.state }`);

    return;
  }

  try {
    switch (arg) {
    case 'fast':
      await k8smanager.reset(cfg);
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
    if (context.interactive) {
      handleFailure(ex);
    } else {
      console.error(ex);
    }
  }
}

ipcMainProxy.on('k8s-restart', async() => {
  if (cfg.kubernetes.port !== k8smanager.kubeBackend.desiredPort) {
    // On port change, we need to wipe the VM.
    return doK8sReset('wipe', { interactive: true });
  } else if (cfg.kubernetes.containerEngine !== currentContainerEngine || cfg.kubernetes.enabled !== enabledK8s) {
    return doK8sReset('fullRestart', { interactive: true });
  }
  try {
    switch (k8smanager.state) {
    case K8s.State.STOPPED:
    case K8s.State.STARTED:
    case K8s.State.DISABLED:
      // Calling start() will restart the backend, possible switching versions
      // as a side-effect.
      await startK8sManager();
      break;
    }
  } catch (ex) {
    handleFailure(ex);
  }
});

ipcMainProxy.on('k8s-versions', async() => {
  window.send('k8s-versions', await k8smanager.kubeBackend.availableVersions, await k8smanager.kubeBackend.cachedVersionsOnly());
});

ipcMainProxy.on('k8s-progress', () => {
  window.send('k8s-progress', k8smanager.progress);
});

ipcMainProxy.handle('service-fetch', (_, namespace) => {
  return k8smanager.kubeBackend.listServices(namespace);
});

ipcMainProxy.handle('service-forward', async(_, service, state) => {
  const namespace = service.namespace ?? 'default';

  if (state) {
    const hostPort = service.listenPort ?? 0;

    await k8smanager.kubeBackend.forwardPort(namespace, service.name, service.port, hostPort);
  } else {
    await k8smanager.kubeBackend.cancelForward(namespace, service.name, service.port);
  }
});

ipcMainProxy.on('k8s-integrations', async() => {
  mainEvents.emit('integration-update', await integrationManager.listIntegrations() ?? {});
});

ipcMainProxy.on('k8s-integration-set', (event, name, newState) => {
  writeSettings({ kubernetes: { WSLIntegrations: { [name]: newState } } });
});

mainEvents.on('integration-update', (state) => {
  window.send('k8s-integrations', state);
});

/**
 * Do a factory reset of the application.  This will stop the currently running
 * cluster (if any), and delete all of its data.  This will also remove any
 * rancher-desktop data, and restart the application.
 *
 * We need to write out rdctl output to a temporary directory because the logs directory
 * will get removed by the factory-reset. This code writes out (to background.log) where this file
 * exists, but if the user isn't tailing that file they won't see the message.
 */
async function doFactoryReset(keepSystemImages: boolean) {
  // Don't wait for this process to return -- the whole point is for us to not be running.
  const tmpdir = os.tmpdir();
  const outfile = await fs.promises.open(path.join(tmpdir, 'rdctl-stdout.txt'), 'w');
  const rdctl = spawn(path.join(paths.resources, os.platform(), 'bin', 'rdctl'),
    ['factory-reset', `--remove-kubernetes-cache=${ (!keepSystemImages) ? 'true' : 'false' }`],
    {
      detached: true, windowsHide: true, stdio: ['ignore', outfile.fd, outfile.fd],
    });

  rdctl.unref();
  console.debug(`If factory-reset fails, the rdctl factory-reset output files are in ${ tmpdir }`);
}

ipcMainProxy.on('factory-reset', (event, keepSystemImages) => {
  doFactoryReset(keepSystemImages);
});

ipcMainProxy.on('show-logs', async(event) => {
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

ipcMainProxy.on('diagnostics/run', () => {
  diagnostics.runChecks();
});

ipcMainProxy.on('get-app-version', async(event) => {
  event.reply('get-app-version', await getVersion());
});

ipcMainProxy.on('help/preferences/open-url', async() => {
  Help.preferences.openUrl(await getVersion());
});

ipcMainProxy.handle('show-message-box', (_event, options: Electron.MessageBoxOptions, modal = false): Promise<Electron.MessageBoxReturnValue> => {
  return window.showMessageBox(options, modal);
});

Electron.ipcMain.handle('show-message-box-rd', async(_event, options: Electron.MessageBoxOptions, modal = false) => {
  const mainWindow = modal ? window.getWindow('main') : null;

  const dialog = window.openDialog(
    'Dialog',
    {
      modal,
      parent: mainWindow || undefined,
      frame:  true,
      title:  options.title,
      height: 225,
    });

  let response: any;

  dialog.webContents.on('ipc-message', (_event, channel, args) => {
    if (channel === 'dialog/mounted') {
      dialog.webContents.send('dialog/options', options);
    }

    if (channel === 'dialog/close') {
      response = args || { response: options.cancelId };
      dialog.close();
    }
  });

  dialog.on('close', () => {
    if (response) {
      return;
    }

    response = { response: options.cancelId };
  });

  await (new Promise<void>((resolve) => {
    dialog.on('closed', resolve);
  }));

  return response;
});

function showErrorDialog(title: string, message: string, fatal?: boolean) {
  Electron.dialog.showErrorBox(title, message);
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
      if (noModalDialogs) {
        console.log(titlePart);
        console.log(secondaryMessage || message);
        console.log(failureDetails);
        gone = true;
        Electron.app.quit();
      } else {
        await window.openKubernetesErrorMessageWindow(titlePart, secondaryMessage || message, failureDetails);
      }

      return;
    }
  } catch (e) {
    console.log(`Failed to get failure details: `, e);
  }
  if (noModalDialogs) {
    console.log(titlePart);
    console.log(message);
    gone = true;
    Electron.app.quit();
  } else {
    showErrorDialog(titlePart, message, payload instanceof K8s.KubernetesError && payload.fatal);
  }
}

function doFullRestart(context: CommandWorkerInterface.CommandContext) {
  doK8sReset('fullRestart', context).catch((err: any) => {
    console.log(`Error restarting: ${ err }`);
  });
}

function newK8sManager() {
  const arch = (Electron.app.runningUnderARM64Translation || os.arch() === 'arm64') ? 'aarch64' : 'x86_64';
  const mgr = K8sFactory(arch, dockerDirManager);

  mgr.on('state-changed', (state: K8s.State) => {
    mainEvents.emit('k8s-check-state', mgr);
    window.send('k8s-check-state', state);
    if ([K8s.State.STARTED, K8s.State.DISABLED].includes(state)) {
      if (!cfg.kubernetes.version) {
        writeSettings({ kubernetes: { version: mgr.kubeBackend.version } });
      }
      currentImageProcessor?.relayNamespaces();

      if (enabledK8s) {
        Steve.getInstance().start();
      }
    }

    if (state === K8s.State.STOPPING) {
      Steve.getInstance().stop();
    }
    if (pendingRestartContext !== undefined && !backendIsBusy()) {
      // If we restart immediately the QEMU process in the VM doesn't always respond to a shutdown messages
      setTimeout(doFullRestart, 2_000, pendingRestartContext);
      pendingRestartContext = undefined;
    }
  });

  mgr.on('progress', () => {
    window.send('k8s-progress', mgr.progress);
  });

  mgr.on('show-notification', (notificationOptions: Electron.NotificationConstructorOptions) => {
    (new Electron.Notification(notificationOptions)).show();
  });

  mgr.kubeBackend.on('current-port-changed', (port: number) => {
    window.send('k8s-current-port', port);
  });

  mgr.kubeBackend.on('kim-builder-uninstalled', () => {
    writeSettings({ kubernetes: { checkForExistingKimBuilder: false } });
  });

  mgr.kubeBackend.on('service-changed', (services: K8s.ServiceEntry[]) => {
    console.debug(`service-changed: ${ JSON.stringify(services) }`);
    window.send('service-changed', services);
  });

  mgr.kubeBackend.on('service-error', (service: K8s.ServiceEntry, errorMessage: string) => {
    console.debug(`service-error: ${ errorMessage }, ${ JSON.stringify(service) }`);
    window.send('service-error', service, errorMessage);
  });

  mgr.kubeBackend.on('versions-updated', async() => {
    window.send('k8s-versions', await mgr.kubeBackend.availableVersions, await mgr.kubeBackend.cachedVersionsOnly());
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

  /**
   * Use the settings validator to validate settings after doing any
   * initialization.
   */
  protected async validateSettings(...args: Parameters<SettingsValidator['validateSettings']>) {
    if (this.k8sVersions.length === 0) {
      this.k8sVersions = (await k8smanager.kubeBackend.availableVersions).map(entry => entry.version.version);
      this.settingsValidator.k8sVersions = this.k8sVersions;
    }

    return this.settingsValidator.validateSettings(...args);
  }

  getSettings() {
    return jsonStringifyWithWhiteSpace(cfg);
  }

  getDiagnosticCategories(): string[]|undefined {
    return diagnostics.getCategoryNames();
  }

  getDiagnosticIdsByCategory(category: string): string[]|undefined {
    return diagnostics.getIdsForCategory(category);
  }

  getDiagnosticChecks(category: string|null, checkID: string|null): Promise<DiagnosticsResultCollection> {
    return diagnostics.getChecks(category, checkID);
  }

  runDiagnosticChecks(): Promise<DiagnosticsResultCollection> {
    return diagnostics.runChecks();
  }

  factoryReset(keepSystemImages: boolean) {
    doFactoryReset(keepSystemImages);
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
  async updateSettings(context: CommandWorkerInterface.CommandContext, newSettings: RecursivePartial<settings.Settings>): Promise<[string, string]> {
    const [needToUpdate, errors] = await this.validateSettings(cfg, newSettings);

    if (errors.length > 0) {
      return ['', `errors in attempt to update settings:\n${ errors.join('\n') }`];
    }
    if (needToUpdate) {
      writeSettings(newSettings);
      // cfg is a global, and at this point newConfig has been merged into it :(
      window.send('settings-update', cfg);
    } else {
      // Obviously if there are no settings to update, there's no need to restart.
      return ['no changes necessary', ''];
    }

    // Update image allow list patterns, just in case the backend doesn't need restarting
    const allowListConf = BackendHelper.createImageAllowListConf(cfg.containerEngine.imageAllowList);
    const rcService = k8smanager.backend === 'wsl' ? 'wsl-service' : 'rc-service';

    await k8smanager.executor.writeFile(`/usr/local/openresty/nginx/conf/image-allow-list.conf`, allowListConf, 0o644);
    await k8smanager.executor.execCommand({ root: true }, rcService, '--ifstarted', 'openresty', 'reload');

    // Check if the newly applied preferences demands a restart of the backend.
    const restartReasons = await k8smanager.requiresRestartReasons(cfg);

    if (Object.keys(restartReasons).length === 0) {
      return ['settings updated; no restart required', ''];
    }

    // Trigger a restart of the backend (possibly delayed).
    if (!backendIsBusy()) {
      pendingRestartContext = undefined;
      setImmediate(doFullRestart, context);

      return ['reconfiguring Rancher Desktop to apply changes (this may take a while)', ''];
    } else {
      // Call doFullRestart once the UI is finished starting or stopping
      pendingRestartContext = context;

      return ['UI is currently busy, but will eventually be reconfigured to apply requested changes', ''];
    }
  }

  async proposeSettings(context: CommandWorkerInterface.CommandContext, newSettings: RecursivePartial<settings.Settings>): Promise<[string, string]> {
    const [, errors] = await this.validateSettings(cfg, newSettings);

    if (errors.length > 0) {
      return ['', `Errors in proposed settings:\n${ errors.join('\n') }`];
    }
    const result = await k8smanager?.requiresRestartReasons(newSettings ?? {}) ?? {};

    return [JSON.stringify(result), ''];
  }

  async requestShutdown() {
    httpCommandServer?.closeServer();
    httpCredentialHelperServer.closeServer();
    await k8smanager.stop();
    Electron.app.quit();
  }

  getTransientSettings() {
    return jsonStringifyWithWhiteSpace(TransientSettings.value);
  }

  updateTransientSettings(
    context: CommandWorkerInterface.CommandContext,
    newTransientSettings: RecursivePartial<TransientSettings>,
  ): Promise<[string, string]> {
    const [needToUpdate, errors] = this.settingsValidator.validateTransientSettings(TransientSettings.value, newTransientSettings);

    return Promise.resolve((() => {
      if (errors.length > 0) {
        return ['', `errors in attempt to update Transient Settings:\n${ errors.join('\n') }`];
      }
      if (needToUpdate) {
        TransientSettings.update(newTransientSettings);

        return ['Updated Transient Settings', ''];
      }

      return ['No changes necessary', ''];
    })());
  }
}

/**
 * Checks if Rancher Desktop was run as root.
 */
function isRoot(): boolean {
  const validPlatforms = ['linux', 'darwin'];

  if (!['linux', 'darwin'].includes(os.platform())) {
    throw new Error(`isRoot() can only be called on ${ validPlatforms }`);
  }

  return os.userInfo().uid === 0;
}
