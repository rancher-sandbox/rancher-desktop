import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import util from 'util';

import Electron, { MessageBoxOptions } from 'electron';
import _ from 'lodash';
import semver from 'semver';

import { State } from '@pkg/backend/backend';
import BackendHelper from '@pkg/backend/backendHelper';
import K8sFactory from '@pkg/backend/factory';
import { getImageProcessor } from '@pkg/backend/images/imageFactory';
import { ImageProcessor } from '@pkg/backend/images/imageProcessor';
import * as K8s from '@pkg/backend/k8s';
import { Steve } from '@pkg/backend/steve';
import { FatalCommandLineOptionError, LockedFieldError, updateFromCommandLine } from '@pkg/config/commandLineOptions';
import { Help } from '@pkg/config/help';
import * as settings from '@pkg/config/settings';
import * as settingsImpl from '@pkg/config/settingsImpl';
import { TransientSettings } from '@pkg/config/transientSettings';
import { IntegrationManager, getIntegrationManager } from '@pkg/integrations/integrationManager';
import { PathManagementStrategy, PathManager } from '@pkg/integrations/pathManager';
import { getPathManagerFor } from '@pkg/integrations/pathManagerImpl';
import { BackendState, CommandWorkerInterface, HttpCommandServer } from '@pkg/main/commandServer/httpCommandServer';
import SettingsValidator from '@pkg/main/commandServer/settingsValidator';
import { HttpCredentialHelperServer } from '@pkg/main/credentialServer/httpCredentialHelperServer';
import { DashboardServer } from '@pkg/main/dashboardServer';
import { DeploymentProfileError, readDeploymentProfiles } from '@pkg/main/deploymentProfiles';
import { DiagnosticsManager, DiagnosticsResultCollection } from '@pkg/main/diagnostics/diagnostics';
import { ExtensionErrorCode, isExtensionError } from '@pkg/main/extensions';
import { ImageEventHandler } from '@pkg/main/imageEvents';
import { getIpcMainProxy } from '@pkg/main/ipcMain';
import mainEvents from '@pkg/main/mainEvents';
import buildApplicationMenu from '@pkg/main/mainmenu';
import setupNetworking from '@pkg/main/networking';
import { Snapshots } from '@pkg/main/snapshots/snapshots';
import { Snapshot, SnapshotDialog } from '@pkg/main/snapshots/types';
import { Tray } from '@pkg/main/tray';
import setupUpdate from '@pkg/main/update';
import { spawnFile } from '@pkg/utils/childProcess';
import getCommandLineArgs from '@pkg/utils/commandLine';
import dockerDirManager from '@pkg/utils/dockerDirManager';
import { isDevEnv } from '@pkg/utils/environment';
import Logging, { clearLoggingDirectory, setLogLevel } from '@pkg/utils/logging';
import { fetchMacOsVersion, getMacOsVersion } from '@pkg/utils/osVersion';
import paths from '@pkg/utils/paths';
import { protocolsRegistered, setupProtocolHandlers } from '@pkg/utils/protocols';
import { executable } from '@pkg/utils/resources';
import { jsonStringifyWithWhiteSpace } from '@pkg/utils/stringify';
import { RecursivePartial, RecursiveReadonly } from '@pkg/utils/typeUtils';
import { getVersion } from '@pkg/utils/version';
import getWSLVersion from '@pkg/utils/wslVersion';
import * as window from '@pkg/window';
import { closeDashboard, openDashboard } from '@pkg/window/dashboard';
import { openPreferences, preferencesSetDirtyFlag } from '@pkg/window/preferences';

// https://www.electronjs.org/docs/latest/breaking-changes#changed-gtk-4-is-default-when-running-gnome
if (process.platform === 'linux') {
  Electron.app.commandLine.appendSwitch('gtk-version', '3');
}

Electron.app.setPath('userData', path.join(paths.appHome, 'electron'));
Electron.app.setPath('cache', paths.cache);
Electron.app.setAppLogsPath(paths.logs);

const console = Logging.background;

// Do an early check for debugging enabled via the environment variable so that
// we can turn on extra logging to troubleshoot startup issues.
if (settingsImpl.runInDebugMode(false)) {
  setLogLevel('debug');
}

if (!Electron.app.requestSingleInstanceLock()) {
  process.exit(201);
}

clearLoggingDirectory();

const SNAPSHOT_OPERATION = 'Snapshot operation in progress';

const ipcMainProxy = getIpcMainProxy(console);
const k8smanager = newK8sManager();
const diagnostics: DiagnosticsManager = new DiagnosticsManager();

let cfg: settings.Settings;
let firstRunDialogComplete = false;
let gone = false; // when true indicates app is shutting down
let imageEventHandler: ImageEventHandler | null = null;
let currentContainerEngine = settings.ContainerEngine.NONE;
let currentImageProcessor: ImageProcessor | null = null;
let enabledK8s: boolean;
let pathManager: PathManager;
const integrationManager: IntegrationManager = getIntegrationManager();
let noModalDialogs = false;
// Indicates whether the UI should be locked, settings changes should be disallowed
// and possibly other things should be disallowed. As of the time of writing,
// set to true when a snapshot is being created or restored.
let deploymentProfiles: settings.DeploymentProfileType = { defaults: {}, locked: {} };

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

let httpCommandServer: HttpCommandServer | null = null;
const httpCredentialHelperServer = new HttpCredentialHelperServer();

if (process.platform === 'linux') {
  // On Linux, put Electron into a new process group so that we can more
  // reliably kill processes we spawn from extensions.
  import('posix-node').then(({ default: { setpgid } }) => {
    setpgid?.(0, 0);
  }).catch(ex => {
    console.error(`Ignoring error setting process group: ${ ex }`);
  });
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

Electron.app.on('second-instance', async() => {
  await protocolsRegistered;
  console.warn('A second instance was started');
  if (firstRunDialogComplete) {
    window.openMain();
  }
});

// takes care of any propagation of settings we want to do
// when settings change
mainEvents.on('settings-update', async(newSettings) => {
  console.log(`mainEvents settings-update: ${ JSON.stringify(newSettings) }`);
  const runInDebugMode = settingsImpl.runInDebugMode(newSettings.application.debug);

  if (runInDebugMode) {
    setLogLevel('debug');
  } else {
    setLogLevel('info');
  }
  k8smanager.debug = runInDebugMode;

  if (gone) {
    console.debug('Suppressing settings-update because app is quitting');

    return;
  }

  await setPathManager(newSettings.application.pathManagementStrategy);
  await pathManager.enforce();

  if (newSettings.application.hideNotificationIcon) {
    Tray.getInstance(cfg).hide();
  } else {
    if (firstRunDialogComplete) {
      Tray.getInstance(cfg).show();
    }
    mainEvents.emit('k8s-check-state', k8smanager);
  }

  await runRdctlSetup(newSettings);
  window.send('preferences/changed');
});

mainEvents.handle('settings-fetch', () => {
  return Promise.resolve(cfg);
});

Electron.protocol.registerSchemesAsPrivileged([{ scheme: 'app' }, {
  scheme:     'x-rd-extension',
  privileges: {
    standard:            true,
    secure:              true,
    bypassCSP:           true,
    allowServiceWorkers: true,
    supportFetchAPI:     true,
    corsEnabled:         true,
  },
}]);

Electron.app.whenReady().then(async() => {
  try {
    const commandLineArgs = getCommandLineArgs();

    // Normally `noModalDialogs` is set when we call `updateFromCommandLine(.., commandLineArgs)`
    // But if there's an error either in that function, or before, we'll need to know if we should
    // display the error in a modal-dialog or not. So check the current command-line arguments for that.
    //
    // It's very unlikely that a string option is set to this exact string though.
    // `rdctl start --images.namespace --no-modal-dialogs`
    // is syntactically correct, but unlikely (because why would someone create a
    // containerd namespace called "--no-modal-dialogs"?
    noModalDialogs = commandLineArgs.includes('--no-modal-dialogs');
    setupProtocolHandlers();

    // make sure we have the macOS version cached before calling getMacOsVersion()
    if (os.platform() === 'darwin') {
      await fetchMacOsVersion(console);
    }

    // Needs to happen before any file is written; otherwise, that file
    // could be owned by root, which will lead to future problems.
    if (['linux', 'darwin'].includes(os.platform())) {
      await checkForRootPrivs();
    }
    // Check for required OS versions and features
    await checkPrerequisites();

    DashboardServer.getInstance().init();

    await setupNetworking();

    try {
      deploymentProfiles = await readDeploymentProfiles();
    } catch (ex: any) {
      if (ex instanceof DeploymentProfileError) {
        await handleFailure(ex);
      } else {
        console.log(`Got an unexpected deployment profile error ${ ex }`, ex);
      }

      throw ex;
    }
    try {
      cfg = settingsImpl.load(deploymentProfiles);
      settingsImpl.updateLockedFields(deploymentProfiles.locked);
    } catch (err: any) {
      const titlePart = err.name || 'Failed to load settings';
      const message = err.message || err.toString();

      showErrorDialog(titlePart, message, true);

      // showErrorDialog doesn't exit immediately; avoid running the rest of the function
      return;
    }
    try {
      // The profile loader did rudimentary type-validation on profiles, but the validator checks for things
      // like invalid strings for application.pathManagementStrategy.
      validateEarlySettings(settings.defaultSettings, deploymentProfiles.defaults, {});
      validateEarlySettings(settings.defaultSettings, deploymentProfiles.locked, {});

      if (commandLineArgs.length) {
        cfg = updateFromCommandLine(cfg, settingsImpl.getLockedSettings(), commandLineArgs);
        k8smanager.noModalDialogs = noModalDialogs = TransientSettings.value.noModalDialogs;
      }
    } catch (err: any) {
      noModalDialogs = TransientSettings.value.noModalDialogs;
      if (err instanceof LockedFieldError || err instanceof DeploymentProfileError || err instanceof FatalCommandLineOptionError) {
        handleFailure(err).catch((err2: any) => {
          console.log('Internal error trying to show a failure dialog: ', err2);
          process.exit(2);
        });

        // Avoid running the rest of the `whenReady` handler after calling this handleFailure -- shutdown is imminent
        return;
      } else if (!noModalDialogs) {
        showErrorDialog('Invalid command-line arguments', err.message, false);
      }
      console.log(`Failed to update command from argument ${ commandLineArgs.join(', ') }`, err);
    }

    httpCommandServer = new HttpCommandServer(new BackgroundCommandWorker());
    await httpCommandServer.init();
    await httpCredentialHelperServer.init();

    await initUI();
    await checkForBackendLock();
    await setPathManager(cfg.application.pathManagementStrategy);
    await integrationManager.enforce();

    mainEvents.emit('settings-update', cfg);

    // Set up the updater; we may need to quit the app if an update is already
    // queued.
    if (await setupUpdate(cfg.application.updater.enabled, true)) {
      gone = true;
      // The update code will trigger a restart; don't do it here, as it may not
      // be ready yet.
      console.log('Will apply update; skipping startup.');

      return;
    }

    try {
      await dockerDirManager.ensureCredHelperConfigured();
    } catch (ex: any) {
      const errorTitle = 'Error configuring credential helper';

      console.error(`${ errorTitle }:`, ex);

      const title = ex.title ?? errorTitle;
      const message = ex.message ?? ex.toString();

      showErrorDialog(title, message, true);
    }

    diagnostics.runChecks().catch(console.error);

    await startBackend();
  } catch (ex: any) {
    console.error(`Error starting up: ${ ex }`, ex.stack);
    gone = true;
    Electron.app.quit();
  }
});

async function setPathManager(newStrategy: PathManagementStrategy) {
  if (pathManager) {
    if (pathManager.strategy === newStrategy) {
      return;
    }
    await pathManager.remove();
  }
  pathManager = getPathManagerFor(newStrategy);
}

/**
 * Reads the 'backend.lock' file and returns its contents if it exists.
 * Returns null if the file doesn't exist.
 */
async function readBackendLockFile(): Promise<{ action: string } | null> {
  try {
    const fileContents = await fs.promises.readFile(
      path.join(paths.appHome, 'backend.lock'),
      'utf-8',
    );

    return JSON.parse(fileContents);
  } catch (ex: any) {
    if (ex.code === 'ENOENT') {
      return null;
    } else {
      throw ex;
    }
  }
}

/**
 * Emits the 'backend-locked-update' event.
 */
function updateBackendLockState(backendIsLocked: string, action?: string): void {
  mainEvents.emit('backend-locked-update', backendIsLocked, action);
}

/**
 * Checks for the existence of the 'backend.lock' file and emits the
 * 'backend-locked-update' event to notify listeners about the current lock
 * status.
 */
async function doesBackendLockExist(): Promise<boolean> {
  let backendIsLocked = '';

  const lockFileContents = await readBackendLockFile();

  if (lockFileContents !== null) {
    backendIsLocked = SNAPSHOT_OPERATION;
    updateBackendLockState(backendIsLocked, lockFileContents.action);
  } else {
    backendIsLocked = '';
    updateBackendLockState(backendIsLocked);
  }

  return !!backendIsLocked;
}

/**
 * Blocks execution until the 'backend.lock' file is no longer present.
 */
async function checkForBackendLock() {
  // Perform an initial check for a lock file
  if (!await doesBackendLockExist()) {
    return;
  }

  const startTime = Date.now();

  // Check every second if a lock file exists
  while (await doesBackendLockExist()) {
    // Notify when a lock file has existed for more than 5 minutes
    if (Date.now() - startTime >= 300_000) {
      mainEvents.emit(
        'dialog-info',
        {
          dialog:  'SnapshotsDialog',
          infoKey: 'snapshots.info.lock.info',
        },
      );
    }
    await util.promisify(setTimeout)(1_000);
  }
}

async function initUI() {
  await doFirstRunDialog();

  if (gone) {
    console.log('User triggered quit during first-run');

    return;
  }

  buildApplicationMenu();

  Electron.app.setAboutPanelOptions({
    // TODO: Update this to 2021-... as dev progresses
    // also needs to be updated in electron-builder.yml
    copyright:          'Copyright © 2021-2025 SUSE LLC',
    applicationName:    `${ Electron.app.name } by SUSE`,
    applicationVersion: `Version ${ await getVersion() }`,
    iconPath:           path.join(paths.resources, 'icons', 'logo-square-512.png'),
  });

  if (!cfg.application.hideNotificationIcon) {
    Tray.getInstance(cfg).show();
  }

  if (!cfg.application.startInBackground) {
    window.openMain();
  } else if (Electron.app.dock) {
    Electron.app.dock.hide();
  }
}

async function doFirstRunDialog() {
  if (!noModalDialogs && settingsImpl.firstRunDialogNeeded()) {
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

async function checkPrerequisites() {
  const osPlatform = os.platform();
  let messageId: window.reqMessageId = 'ok';
  let args: any[] = [];

  switch (osPlatform) {
  case 'win32': {
    // Required: Windows 10-1909(build 18363) or newer
    const winRel = os.release().split('.');

    if (Number(winRel[0]) < 10 || (Number(winRel[0]) === 10 && Number(winRel[2]) < 18363)) {
      messageId = 'win32-release';
    } else {
      try {
        const version = await getWSLVersion();

        if (version.outdated_kernel) {
          messageId = 'win32-kernel';
          args = [version];
        }
      } catch (ex) {
        console.error(`Failed to check WSL version, ignoring:`, ex);
      }
    }
    break;
  }
  case 'linux': {
    // TODO: This whole testing for nested virtualization is wrong. All we should test for is if
    // hardware acceleration is available, e.g. checking /proc/cpuinfo for "vmx" (Intel) or "svm" (AMD).
    if (process.arch === 'x64') {
      // Required: Nested virtualization enabled
      const nestedFiles = [
        '/sys/module/kvm_amd/parameters/nested',
        '/sys/module/kvm_intel/parameters/nested'];

      messageId = 'linux-nested';
      for (const nestedFile of nestedFiles) {
        try {
          const data = await fs.promises.readFile(nestedFile, { encoding: 'utf8' });

          if (data && (data.toLowerCase().startsWith('y') || data.startsWith('1'))) {
            messageId = 'ok';
            break;
          }
        } catch {
        }
      }
    }
    break;
  }
  case 'darwin': {
    // Required: macOS-10.15(Darwin-19) or newer
    if (semver.gt('10.15.0', getMacOsVersion())) {
      messageId = 'macOS-release';
    }
    break;
  }
  }

  if (messageId !== 'ok') {
    await window.openUnmetPrerequisitesDialog(messageId, ...args);
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
async function startBackend() {
  await checkBackendValid();

  // A string describing why we're ignoring the request.
  const ignoreReason = {
    [K8s.State.STOPPED]:  undefined, // Normal start is accepted.
    [K8s.State.STARTING]: 'Ignoring duplicate attempt to start backend while starting backend.',
    [K8s.State.STARTED]:  'Ignoring attempt to start already-started backend.',
    [K8s.State.STOPPING]: 'Ignoring attempt to start backend while stopping.',
    [K8s.State.ERROR]:    undefined, // Attempting start from error state is fine.
    [K8s.State.DISABLED]: 'Ignoring attempt to start already-started backend (Kubernetes disabled).',
  }[k8smanager.state];

  if (ignoreReason) {
    console.debug(ignoreReason);

    return;
  }
  try {
    await startK8sManager();
  } catch (err) {
    handleFailure(err);
  } finally {
    window.send('extensions/changed');
  }
}

/**
 * Start the backend.
 *
 * @note Callers are responsible for handling errors thrown from here.
 */
async function startK8sManager() {
  const changedContainerEngine = currentContainerEngine !== cfg.containerEngine.name;

  currentContainerEngine = cfg.containerEngine.name;
  enabledK8s = cfg.kubernetes.enabled;

  if (changedContainerEngine) {
    setupImageProcessor();
  }
  await k8smanager.start(cfg);

  const { initializeExtensionManager } = await import('@pkg/main/extensions/manager');

  await initializeExtensionManager(k8smanager.containerEngineClient, cfg);
  window.send('extensions/changed');
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
  const imageProcessor = getImageProcessor(cfg.containerEngine.name, k8smanager);

  currentImageProcessor?.deactivate();
  if (!imageEventHandler) {
    imageEventHandler = new ImageEventHandler(imageProcessor);
  }

  imageEventHandler.imageProcessor = imageProcessor;
  currentImageProcessor = imageProcessor;
  currentImageProcessor?.activate();
  currentImageProcessor.namespace = cfg.images.namespace;
  window.send('k8s-current-engine', cfg.containerEngine.name);
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
    await mainEvents.tryInvoke('extensions/shutdown');
    await k8smanager?.stop();
    await mainEvents.tryInvoke('shutdown-integrations');

    console.log(`2: Child exited cleanly.`);
  } catch (ex: any) {
    console.log(`2: Child exited with code ${ isK8sError(ex) ? ex.errCode : (ex.errCode ?? '<unknown>') }`);
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
  await protocolsRegistered;
  window.openMain();
});

mainEvents.on('backend-locked-update', (backendIsLocked, action) => {
  if (backendIsLocked) {
    window.send('backend-locked', action);
  } else {
    window.send('backend-unlocked');
  }
});

mainEvents.on('backend-locked-check', async() => {
  await doesBackendLockExist();
});

ipcMainProxy.on('backend-state-check', async() => {
  await doesBackendLockExist();
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
  openPreferences();
});

ipcMainProxy.on('preferences-close', () => {
  window.getWindow('preferences')?.close();
});

ipcMainProxy.on('preferences-set-dirty', (_event, dirtyFlag) => {
  preferencesSetDirtyFlag(dirtyFlag);
});

ipcMainProxy.on('get-debugging-statuses', () => {
  window.send('is-debugging', settingsImpl.runInDebugMode(cfg.application.debug));
  window.send('always-debugging', settingsImpl.runInDebugMode(false));
});
function writeSettings(arg: RecursivePartial<RecursiveReadonly<settings.Settings>>) {
  settingsImpl.save(settingsImpl.merge(cfg, arg));
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

mainEvents.on('extensions/ui/uninstall', (id) => {
  window.send('ok:extensions/uninstall', id);
});

mainEvents.on('dialog-info', (args) => {
  window.getWindow(args.dialog)?.webContents.send('dialog/info', args);
});

ipcMainProxy.on('extensions/open', (_event, id, path) => {
  window.openExtension(id, path);
});

ipcMainProxy.on('extensions/close', () => {
  window.closeExtension();
});

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

ipcMainProxy.handle('api-get-credentials', () => mainEvents.invoke('api-get-credentials'));

ipcMainProxy.handle('get-locked-fields', () => settingsImpl.getLockedSettings());

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
  } else if (cfg.containerEngine.name !== currentContainerEngine || cfg.kubernetes.enabled !== enabledK8s) {
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
  try {
    const versions = await k8smanager.kubeBackend.availableVersions;
    const cachedOnly = await k8smanager.kubeBackend.cachedVersionsOnly();

    window.send('k8s-versions', versions.map(v => v.versionEntry), cachedOnly);
  } catch (ex) {
    console.error(`Error handling k8s-versions: ${ ex }`);
    window.send('k8s-versions', [], true);
  }
});

ipcMainProxy.on('k8s-progress', () => {
  window.send('k8s-progress', k8smanager.progress);
});

ipcMainProxy.handle('k8s-progress', () => {
  return k8smanager.progress;
});

ipcMainProxy.handle('service-fetch', (_, namespace) => {
  return k8smanager.kubeBackend.listServices(namespace);
});

ipcMainProxy.handle('service-forward', async(_, service, state) => {
  const namespace = service.namespace ?? 'default';

  if (state) {
    const hostPort = service.listenPort ?? 0;

    await doForwardPort(namespace, service.name, service.port, hostPort);
  } else {
    await doCancelForward(namespace, service.name, service.port);
  }
});

async function doForwardPort(namespace: string, service: string, k8sPort: string | number, hostPort: number) {
  return await k8smanager.kubeBackend.forwardPort(namespace, service, k8sPort, hostPort);
}

async function doCancelForward(namespace: string, service: string, k8sPort: string | number) {
  return await k8smanager.kubeBackend.cancelForward(namespace, service, k8sPort);
}

ipcMainProxy.on('k8s-integrations', async() => {
  mainEvents.emit('integration-update', await integrationManager.listIntegrations() ?? {});
});

ipcMainProxy.on('k8s-integration-set', (event, name, newState) => {
  writeSettings({ WSL: { integrations: { [name]: newState } } });
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
  const args = ['reset', '--factory', `--cache=${ (!keepSystemImages) ? 'true' : 'false' }`];

  if (cfg.application.debug) {
    args.push('--verbose=true');
  }
  const rdctl = spawn(path.join(paths.resources, os.platform(), 'bin', 'rdctl'), args,
    {
      detached: true, windowsHide: true, stdio: ['ignore', outfile.fd, outfile.fd],
    });

  rdctl.unref();
  console.debug(`If reset fails, the rdctl reset output files are in ${ tmpdir }`);
}

ipcMainProxy.on('factory-reset', (event, keepSystemImages) => {
  doFactoryReset(keepSystemImages);
});

ipcMainProxy.on('show-logs', async(event) => {
  const error = await Electron.shell.openPath(paths.logs);

  if (error) {
    const browserWindow = Electron.BrowserWindow.fromWebContents(event.sender);
    const options: MessageBoxOptions = {
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

ipcMainProxy.on('snapshot', (event, args) => {
  event.reply('snapshot', args);
});

ipcMainProxy.on('snapshot/cancel', () => {
  window.send('snapshot/cancel');
});

ipcMainProxy.on('dialog/error', (event, args) => {
  window.getWindow(args.dialog)?.webContents.send('dialog/error', args);
});

ipcMainProxy.on('dialog/close', (_event, args) => {
  window.getWindow(args.dialog)?.webContents.send('dialog/close', args);
});

ipcMainProxy.handle('versions/macOs', () => {
  return getMacOsVersion();
});

ipcMainProxy.handle('host/isArm', () => {
  return process.arch === 'arm64';
});

ipcMainProxy.on('help/preferences/open-url', async() => {
  Help.preferences.openUrl(await getVersion());
});

ipcMainProxy.handle('show-message-box', (_event, options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> => {
  return window.showMessageBox(options, false);
});

ipcMainProxy.handle('show-message-box-rd', async(_event, options: Electron.MessageBoxOptions, modal = false) => {
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

ipcMainProxy.handle('show-snapshots-confirm-dialog', async(
  event,
  options: { window: Partial<Electron.MessageBoxOptions>, format: SnapshotDialog },
) => {
  const mainWindow = window.getWindow('main');

  const dialog = window.openDialog(
    'SnapshotsDialog',
    {
      title:   'Snapshots',
      modal:   true,
      parent:  mainWindow || undefined,
      frame:   true,
      movable: true,
      height:  365,
      width:   640,
    });

  if (os.platform() !== 'linux' && mainWindow && dialog) {
    window.centerDialog(mainWindow, dialog, 0, 50);
  }

  let response: any;

  dialog.webContents.on('ipc-message', (_event, channel, args) => {
    if (channel === 'dialog/mounted') {
      options.format.type = 'question';
      dialog.webContents.send('dialog/options', options);
    }

    if (channel === 'dialog/close') {
      response = args || { response: options.window.cancelId };
      dialog.close();
    }
  });

  dialog.on('close', () => {
    if (response) {
      return;
    }

    response = { response: options.window.cancelId };
  });

  await (new Promise<void>((resolve) => {
    dialog.on('closed', resolve);
  }));

  return response;
});

ipcMainProxy.handle('show-snapshots-blocking-dialog', async(
  event,
  options: { window: Partial<Electron.MessageBoxOptions>, format: SnapshotDialog },
) => {
  const dialogId = 'SnapshotsDialog';

  if (window.getWindow(dialogId)) {
    return;
  }

  const mainWindow = window.getWindow('main');

  const dialog = window.openDialog(
    dialogId,
    {
      modal:   true,
      parent:  mainWindow || undefined,
      frame:   false,
      movable: false,
      height:  500,
      width:   700,
    },
    false);

  const onMainWindowMove = () => {
    if (mainWindow && dialog) {
      window.centerDialog(mainWindow, dialog);
    }
  };

  if (mainWindow && dialog) {
    if (os.platform() === 'linux') {
      /** Lock dialog position */
      mainWindow.on('move', onMainWindowMove);
    } else {
      /** Center the dialog on main window, only for MacOs, Windows */
      window.centerDialog(mainWindow, dialog, 0, 50);
    }
  }

  let response: any;

  dialog.webContents.on('ipc-message', (_event, channel, args) => {
    if (channel === 'dialog/mounted') {
      if (os.platform() !== 'darwin') {
        mainWindow?.webContents.send('window/blur', true);
      }

      options.format.type = 'operation';
      dialog.webContents.send('dialog/options', options);
      event.sender.sendToFrame(event.frameId, 'dialog/mounted');
    }

    if (channel === 'dialog/close') {
      response = args || { response: options.window.cancelId };
      dialog.close();
    }
  });

  dialog.on('close', () => {
    if (os.platform() !== 'darwin') {
      mainWindow?.webContents.send('window/blur', false);
    }

    if (os.platform() === 'linux' && mainWindow) {
      mainWindow.off('move', onMainWindowMove);
    }

    if (response) {
      return;
    }

    response = { response: options.window.cancelId };
  });

  await (new Promise<void>((resolve) => {
    dialog.on('closed', resolve);
  }));

  return response;
});

function showErrorDialog(title: string, message: string, fatal?: boolean) {
  if (noModalDialogs) {
    console.log(`Fatal Error:\n${ title }\n\n${ message }`);
  } else {
    Electron.dialog.showErrorBox(title, message);
  }
  if (fatal) {
    Electron.app.quit();
  }
}

async function handleFailure(payload: any) {
  let titlePart = 'Error Starting Rancher Desktop';
  let message = 'There was an unknown error starting Rancher Desktop';
  let secondaryMessage = '';

  if (payload instanceof K8s.KubernetesError) {
    ({ name: titlePart, message } = payload);
  } else if (payload instanceof LockedFieldError) {
    showErrorDialog(titlePart, payload.message, true);

    return;
  } else if (payload instanceof DeploymentProfileError) {
    showErrorDialog('Failed to load the deployment profile', payload.message, true);

    return;
  } else if (payload instanceof FatalCommandLineOptionError) {
    showErrorDialog('Error in command-line options', payload.message, true);

    return;
  } else if (payload instanceof Error) {
    secondaryMessage = payload.toString();
  } else if (typeof payload === 'number') {
    message = `Rancher Desktop was unable to start with the following exit code: ${ payload }`;
  } else if ('errorCode' in payload) {
    message = payload.message || message;
    titlePart = payload.context || titlePart;
  }
  console.log(`Rancher Desktop was unable to start:`, payload);
  try {
    // getFailureDetails is going to read from existing log files.
    // Wait 1 second before reading them to allow recent writes to appear in them.
    await util.promisify(setTimeout)(1_000);
    const failureDetails: K8s.FailureDetails = await k8smanager.getFailureDetails(payload);

    if (failureDetails) {
      if (noModalDialogs) {
        console.log(titlePart);
        console.log(secondaryMessage || message);
        // Since the log is to a file, we need to pretty-print it; otherwise the
        // message will just be `[Object object]`.
        console.log(JSON.stringify(failureDetails, undefined, 2));
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

async function getExtensionManager() {
  const getEM = (await import('@pkg/main/extensions/manager')).default;

  return await getEM();
}

function newK8sManager() {
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  const mgr = K8sFactory(arch);

  mgr.on('state-changed', async(state: K8s.State) => {
    try {
      mainEvents.emit('k8s-check-state', mgr);

      if ([K8s.State.STARTED, K8s.State.DISABLED].includes(state)) {
        if (!cfg.kubernetes.version) {
          writeSettings({ kubernetes: { version: mgr.kubeBackend.version } });
        }
        currentImageProcessor?.relayNamespaces();

        if (enabledK8s) {
          await Steve.getInstance().start();
        }
      }

      // Notify UI after Steve is ready, so the dashboard button is only enabled
      // when Steve can accept connections.
      window.send('k8s-check-state', state);

      if (state === K8s.State.STOPPING) {
        Steve.getInstance().stop();
      }
      if (pendingRestartContext !== undefined && !backendIsBusy()) {
        // If we restart immediately the QEMU process in the VM doesn't always respond to a shutdown messages
        setTimeout(doFullRestart, 2_000, pendingRestartContext);
        pendingRestartContext = undefined;
      }
    } catch (ex) {
      console.error(ex);
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

  mgr.kubeBackend.on('service-changed', (services: K8s.ServiceEntry[]) => {
    console.debug(`service-changed: ${ JSON.stringify(services) }`);
    window.send('service-changed', services);
  });

  mgr.kubeBackend.on('service-error', (service: K8s.ServiceEntry, errorMessage: string) => {
    console.debug(`service-error: ${ errorMessage }, ${ JSON.stringify(service) }`);
    window.send('service-error', service, errorMessage);
  });

  mgr.kubeBackend.on('versions-updated', async() => {
    const versions = await mgr.kubeBackend.availableVersions;
    const cachedOnly = await mgr.kubeBackend.cachedVersionsOnly();

    window.send('k8s-versions', versions.map(v => v.versionEntry), cachedOnly);
  });

  return mgr;
}

function validateEarlySettings(cfg: settings.Settings, newSettings: RecursivePartial<settings.Settings>, lockedFields: settings.LockedSettingsType): void {
  // RD hasn't loaded the supported k8s versions yet, so have it defer actually checking the specified version.
  // If it can't find this version, it will silently move to the closest version.
  // We'd have to add more code to report that.
  // It isn't worth adding that code yet. It might never be needed.
  const newSettingsForValidation = _.omit(newSettings, 'kubernetes.version');
  const [, errors] = new SettingsValidator().validateSettings(cfg, newSettingsForValidation, lockedFields);

  if (errors.length > 0) {
    throw new LockedFieldError(`Error in deployment profiles:\n${ errors.join('\n') }`);
  }
}

/**
 * Implement the methods that HttpCommandServer needs to service its requests.
 * These methods do two things:
 * 1. Verify the semantics of the parameters (the server just checks syntax).
 * 2. Provide a thin wrapper over existing functionality in this module.
 * Getters, on success, return status 200 and a string that may be JSON or simple.
 * Setters, on success, return status 202, possibly with a human-readable status note.
 * The `requestShutdown` method is a special case that never returns.
 */
class BackgroundCommandWorker implements CommandWorkerInterface {
  protected settingsValidator = new SettingsValidator();

  /**
   * Use the settings validator to validate settings after doing any
   * initialization.
   */
  protected async validateSettings(existingSettings: settings.Settings, newSettings: RecursivePartial<settings.Settings>) {
    let clearVersionsAfterTesting = false;

    if (newSettings.kubernetes?.version && this.settingsValidator.k8sVersions.length === 0) {
      // If we're starting up (by running `rdctl start...`) we probably haven't loaded all the k8s versions yet.
      // We don't want to verify if the proposed version makes sense (if it doesn't, we'll assign the default version later).
      // Here we just want to make sure that if we're changing the version to a different value from the current one,
      // the field isn't locked.
      let currentK8sVersions = (await k8smanager.kubeBackend.availableVersions).map(entry => entry.version.version);

      if (currentK8sVersions.length === 0) {
        clearVersionsAfterTesting = true;
        currentK8sVersions = [newSettings.kubernetes.version];
        if (existingSettings.kubernetes.version) {
          currentK8sVersions.push(existingSettings.kubernetes.version);
        }
      }
      this.settingsValidator.k8sVersions = currentK8sVersions;
    }

    const result = this.settingsValidator.validateSettings(existingSettings, newSettings, settingsImpl.getLockedSettings());

    if (clearVersionsAfterTesting) {
      this.settingsValidator.k8sVersions = [];
    }

    return result;
  }

  getSettings() {
    return jsonStringifyWithWhiteSpace(cfg);
  }

  getLockedSettings() {
    return jsonStringifyWithWhiteSpace(settingsImpl.getLockedSettings());
  }

  getDiagnosticCategories(): string[] | undefined {
    return diagnostics.getCategoryNames();
  }

  getDiagnosticIdsByCategory(category: string): string[] | undefined {
    return diagnostics.getIdsForCategory(category);
  }

  getDiagnosticChecks(category: string | null, checkID: string | null): Promise<DiagnosticsResultCollection> {
    return diagnostics.getChecks(category, checkID);
  }

  runDiagnosticChecks(): Promise<DiagnosticsResultCollection> {
    return diagnostics.runChecks();
  }

  factoryReset(keepSystemImages: boolean) {
    doFactoryReset(keepSystemImages);
  }

  async k8sReset(context: CommandWorkerInterface.CommandContext, mode: 'fast' | 'wipe') {
    return await doK8sReset(mode, context);
  }

  async forwardPort(namespace: string, service: string, k8sPort: string | number, hostPort: number) {
    return await doForwardPort(namespace, service, k8sPort, hostPort);
  }

  async cancelForward(namespace: string, service: string, k8sPort: string | number) {
    return await doCancelForward(namespace, service, k8sPort);
  }

  /**
   * Execute the preference update for services that don't require a backend restart.
   */
  async handleSettingsUpdate(newConfig: settings.Settings): Promise<void> {
    const allowedImagesConf = '/usr/local/openresty/nginx/conf/allowed-images.conf';
    const rcService = k8smanager.backend === 'wsl' ? 'wsl-service' : 'rc-service';

    // Update image allow list patterns, just in case the backend doesn't need restarting
    // TODO: review why this block is needed at all
    if (cfg.containerEngine.allowedImages.enabled) {
      const allowListConf = BackendHelper.createAllowedImageListConf(cfg.containerEngine.allowedImages);

      await k8smanager.executor.writeFile(allowedImagesConf, allowListConf, 0o644);
      await k8smanager.executor.execCommand({ root: true }, rcService, '--ifstarted', 'rd-openresty', 'reload');
    } else {
      await k8smanager.executor.execCommand({ root: true }, rcService, '--ifstarted', 'rd-openresty', 'stop');
      await k8smanager.executor.execCommand({ root: true }, 'rm', '-f', allowedImagesConf);
    }

    await k8smanager.handleSettingsUpdate(newConfig);
  }

  /**
   * Check semantics of SET commands:
   * - verify that setting names are recognized, and validate provided values
   * - returns an array of two strings:
   *   1. a description of the status of the request, if it was valid
   *   2. a list of any errors in the request body.
   * @param specifiedNewSettings: a subset of the Settings object, containing the desired values
   * @returns [{string} description of final state if no error, {string} error message]
   */
  async updateSettings(context: CommandWorkerInterface.CommandContext, specifiedNewSettings: RecursivePartial<settings.Settings>): Promise<[string, string]> {
    let errors: string[] = [];
    let needToUpdate = false;
    let newSettings: RecursivePartial<settings.Settings> = {};

    try {
      newSettings = settingsImpl.migrateSpecifiedSettingsToCurrentVersion(specifiedNewSettings, false);
      [needToUpdate, errors] = await this.validateSettings(cfg, newSettings);
    } catch (ex: any) {
      errors.push(ex.message);
    }
    if (errors.length > 0) {
      return ['', `errors in attempt to update settings:\n${ errors.join('\n') }`];
    }
    if (needToUpdate) {
      writeSettings(newSettings);
      // cfg is a global, and at this point newConfig has been merged into it :(
      window.send('settings-update', cfg);
      window.send('preferences/changed');
    } else {
      // Obviously if there are no settings to update, there's no need to restart.
      return ['no changes necessary', ''];
    }

    // Update the values that doesn't need a restart of the backend.
    await this.handleSettingsUpdate(cfg);

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

    return Promise.resolve(((): [string, string] => {
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

  async listExtensions() {
    const extensionManager = await getExtensionManager();

    if (!extensionManager) {
      return undefined;
    }
    const extensions = await extensionManager.getInstalledExtensions();
    const entries = await Promise.all(extensions.map(async x => [x.id, {
      version:  x.version,
      metadata: await x.metadata,
      labels:   await x.labels,
    }] as const));

    return Object.fromEntries(entries);
  }

  async installExtension(image: string, state: 'install' | 'uninstall'): Promise<{ status: number, data?: any }> {
    const em = await getExtensionManager();

    if (!em) {
      return { status: 503, data: 'Extension manager is not ready yet.' };
    }
    const extension = await em.getExtension(image, { preferInstalled: state === 'uninstall' });

    if (state === 'install') {
      console.debug(`Installing extension ${ image }...`);
      try {
        const { enabled, list } = cfg.application.extensions.allowed;

        if (await extension.install(enabled ? list : undefined)) {
          return { status: 201 };
        } else {
          return { status: 204 };
        }
      } catch (ex: any) {
        if (isExtensionError(ex)) {
          switch (ex.code) {
          case ExtensionErrorCode.INVALID_METADATA:
            return { status: 422, data: `The image ${ image } has invalid extension metadata` };
          case ExtensionErrorCode.FILE_NOT_FOUND:
            return { status: 422, data: `The image ${ image } failed to install: ${ ex.message }` };
          case ExtensionErrorCode.INSTALL_DENIED:
            return { status: 403, data: `The image ${ image } is not an allowed extension` };
          }
        }
        throw ex;
      } finally {
        window.send('extensions/changed');
      }
    } else {
      console.debug(`Uninstalling extension ${ image }...`);
      try {
        if (await extension.uninstall()) {
          window.send('ok:extensions/uninstall', image);

          return { status: 201 };
        } else {
          return { status: 204 };
        }
      } catch (ex: any) {
        if (isExtensionError(ex)) {
          switch (ex.code) {
          case ExtensionErrorCode.INVALID_METADATA:
            return { status: 422, data: `The image ${ image } has invalid extension metadata` };
          }
        }
        throw ex;
      } finally {
        window.send('extensions/changed');
      }
    }
  }

  async getBackendState(): Promise<BackendState> {
    const backendIsLocked = await readBackendLockFile();

    return {
      vmState: k8smanager.state,
      locked:  !!backendIsLocked,
    };
  }

  async setBackendState(state: BackendState): Promise<void> {
    await doesBackendLockExist();
    switch (state.vmState) {
    case State.STARTED:
      cfg = settingsImpl.load(deploymentProfiles);
      mainEvents.emit('settings-update', cfg);

      setImmediate(() => {
        startBackend();
      });

      return;
    case State.STOPPED:
      setImmediate(() => {
        k8smanager.stop();
      });

      return;
    default:
      throw new Error(`invalid desired VM state "${ state.vmState }"`);
    }
  }

  async listSnapshots(context: CommandWorkerInterface.CommandContext) {
    return await Snapshots.list();
  }

  async createSnapshot(context: CommandWorkerInterface.CommandContext, snapshot: Snapshot) {
    return await Snapshots.create(snapshot);
  }

  async restoreSnapshot(context: CommandWorkerInterface.CommandContext, name: string) {
    return await Snapshots.restore(name);
  }

  async cancelSnapshot() {
    return await Snapshots.cancel();
  }

  async deleteSnapshot(context: CommandWorkerInterface.CommandContext, name: string) {
    return await Snapshots.delete(name);
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

async function runRdctlSetup(newSettings: settings.Settings): Promise<void> {
  // don't do anything with auto-start configuration if running in development
  if (isDevEnv) {
    return;
  }

  const rdctlPath = executable('rdctl');
  const args = ['setup', `--auto-start=${ newSettings.application.autoStart }`];

  await spawnFile(rdctlPath, args);
}
