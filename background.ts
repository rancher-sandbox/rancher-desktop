import { Console } from 'console';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { URL } from 'url';

import Electron from 'electron';
import _ from 'lodash';

import mainEvents from '@/main/mainEvents';
import { setupKim } from '@/main/kim';
import * as settings from '@/config/settings';
import * as window from '@/window';
import * as K8s from '@/k8s-engine/k8s';
import resources from '@/resources';
import Logging, { PATH as LoggingPath } from '@/utils/logging';
import * as childProcess from '@/utils/childProcess';
import setupNetworking from '@/main/networking';
import setupUpdate from '@/main/update';
import setupTray from '@/main/tray';

Electron.app.setName('Rancher Desktop');

const console = new Console(Logging.background.stream);

let k8smanager = newK8sManager();
let cfg: settings.Settings;
let gone = false; // when true indicates app is shutting down

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
    console.log(`app version: ${ Electron.app.getVersion() }`);
  } catch (err) {
    console.log(`Can't get app version: ${ err }`);
  }
  setupNetworking();
  try {
    setupTray();
  } catch (e) {
    console.log(`\nERROR: ${ e.message }`);
    gone = true;
    Electron.app.quit();

    return;
  }

  // TODO: Check if first install and start welcome screen
  // TODO: Check if new version and provide window with details on changes

  try {
    cfg = settings.init();
  } catch (err) {
    gone = true;
    Electron.app.quit();

    return;
  }

  console.log(cfg);

  // Set up the updater; we may need to quit the app if an update is already
  // queued.
  if (await setupUpdate(cfg, true)) {
    gone = true;
    // The update code will trigger a restart; don't do it here, as it may not
    // be ready yet.
    console.log('Will apply update; skipping startup.');

    return;
  }

  if (!Electron.app.isPackaged) {
    // Install devtools; no need to wait for it to complete.
    const { default: installExtension, VUEJS_DEVTOOLS } = require('electron-devtools-installer');

    installExtension(VUEJS_DEVTOOLS);
  }
  if (await settings.isFirstRun()) {
    if (os.platform() === 'darwin') {
      await Promise.all([
        linkResource('helm', true),
        linkResource('kim', true),
        linkResource('kubectl', true),
      ]);
    }
  }

  // Check if there are any reasons that would mean it makes no sense to
  // continue starting the app.
  const invalidReason = await k8smanager.getBackendInvalidReason();

  if (invalidReason) {
    handleFailure(invalidReason);
    gone = true;
    Electron.app.quit();

    return;
  }

  k8smanager.start(cfg.kubernetes).catch(handleFailure);

  // Set up protocol handler for app://
  // This is needed because in packaged builds we'll not be allowed to access
  // file:// URLs for our resources.
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
  window.openPreferences();

  setupKim(k8smanager);
  setupUpdate(cfg);
});

Electron.app.on('second-instance', () => {
  // Someone tried to run another instance of Rancher Desktop,
  // reveal and focus this window instead.
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
    Electron.app.quit();
  }
});

Electron.app.on('window-all-closed', () => {
  // On macOS, hide the dock icon.
  Electron.app.dock?.hide();
  // On all platforms, we only quit via the notification tray / menu bar.
});

Electron.app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  window.openPreferences();
});

Electron.ipcMain.on('settings-read', (event) => {
  event.returnValue = cfg;
});

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

Electron.ipcMain.handle('settings-write', (event, arg: RecursivePartial<settings.Settings>) => {
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

async function doK8sReset(arg = ''): Promise<void> {
  // If not in a place to restart than skip it
  if (![K8s.State.STARTED, K8s.State.STOPPED, K8s.State.ERROR].includes(k8smanager.state)) {
    console.log(`Skipping reset, invalid state ${ k8smanager.state }`);

    return;
  }

  try {
    if (['slow', 'fast'].includes(arg)) {
      // Leave arg as is
    } else if ((k8smanager.version !== cfg.kubernetes.version ||
        (await k8smanager.cpus) !== cfg.kubernetes.numberCPUs ||
        (await k8smanager.memory) !== cfg.kubernetes.memoryInGB * 1024 ||
        (k8smanager.desiredPort) !== cfg.kubernetes.port)) {
      arg = 'slow';
    }
    switch (arg) {
    case 'fast':
      await k8smanager.reset(cfg.kubernetes);
      break;
    case 'slow':
      await k8smanager.stop();

      console.log(`Stopped Kubernetes backened cleanly.`);
      console.log('Deleting VM to reset...');
      await k8smanager.del();
      console.log(`Deleted VM to reset exited cleanly.`);

      // The desired Kubernetes version might have changed
      k8smanager = newK8sManager();

      await k8smanager.start(cfg.kubernetes);
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
    return doK8sReset();
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

Electron.ipcMain.on('k8s-integration-set', async(event, name: string, newState: boolean) => {
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
    for (const name of ['helm', 'kim', 'kubectl']) {
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
  const logPath = Logging[LoggingPath];
  const error = await Electron.shell.openPath(logPath);

  if (error) {
    const browserWindow = Electron.BrowserWindow.fromWebContents(event.sender);
    const options = {
      message: error,
      type:    'error',
      title:   `Error opening logs`,
      detail:  `Please manually open ${ logPath }`,
    };

    console.error(`Failed to open logs: ${ error }`);
    if (browserWindow) {
      Electron.dialog.showMessageBox(browserWindow, options);
    } else {
      Electron.dialog.showMessageBox(options);
    }
  }
});

Electron.ipcMain.handle('get-app-version', async(event) => {
  return process.env.NODE_ENV === 'production' ? getProductionVersion() : await getDevVersion();
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

/**
 * assume sync activities aren't going to be costly for a UI app.
 * @param name -- basename of the resource to link
 * @param state -- true to symlink, false to delete
 */
async function linkResource(name: string, state: boolean): Promise<Error | null> {
  const linkPath = path.join('/usr/local/bin', name);

  if (state) {
    const err: Error | null = await new Promise((resolve) => {
      fs.symlink(resources.executable(name), linkPath, 'file', resolve);
    });

    if (err) {
      console.error(`Error creating symlink for ${ linkPath }: ${ err.message }`);

      return err;
    }
  } else {
    const err: Error | null = await new Promise((resolve) => {
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
