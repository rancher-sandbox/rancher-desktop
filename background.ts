import { Console } from 'console';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { URL } from 'url';

import Electron from 'electron';
import _ from 'lodash';
import MacCA from 'mac-ca';
import WinCA from 'win-ca';

import mainEvents from '@/main/mainEvents';
import { setupKim } from '@/main/kim';
import * as settings from '@/config/settings';
import { Tray } from '@/menu/tray.js';
import * as window from '@/window';
import * as K8s from '@/k8s-engine/k8s';
import resources from '@/resources';
import Logging from '@/utils/logging';
import * as childProcess from '@/utils/childProcess';
import setupUpdate from '@/main/update';

Electron.app.setName('Rancher Desktop');

const console = new Console(Logging.background.stream);

let k8smanager: K8s.KubernetesBackend;
let cfg: settings.Settings;
let tray: Tray;
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
  if (reason.errno === -61 && reason.code === 'ECONNREFUSED' && reason.port === cfg.kubernetes.port) {
    // Do nothing: a connection to the kubernetes server was broken
  } else {
    promise.catch((error: any) => {
      console.log(`UnhandledRejectionWarning: ${ error }`);
    });
  }
});

Electron.app.whenReady().then(async() => {
  try {
    console.log(`app version: ${ Electron.app.getVersion() }`);
  } catch (err) {
    console.log(`Can't get app version: ${ err }`);
  }
  if (os.platform().startsWith('win')) {
    // Inject the Windows certs.
    WinCA({ inject: '+' });
  }
  try {
    tray = new Tray();
  } catch (e) {
    console.log(`\nERROR: ${ e.message }`);
    gone = true;
    Electron.app.quit();

    return;
  }
  tray.on('window-preferences', () => {
    window.openPreferences();
    Electron.app.dock?.show();
  });

  // TODO: Check if first install and start welcome screen
  // TODO: Check if new version and provide window with details on changes

  k8smanager = newK8sManager();
  try {
    cfg = settings.init(await k8smanager.availableVersions);
  } catch (err) {
    gone = true;
    Electron.app.quit();

    return;
  }

  console.log(cfg);
  tray.emit('settings-update', cfg);

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

  window.send('k8s-current-port', cfg.kubernetes.port);
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

  setupKim();
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

Electron.ipcMain.handle('settings-write', (event, arg: Partial<settings.Settings>) => {
  _.merge(cfg, arg);
  settings.save(cfg);
  mainEvents.emit('settings-update', cfg);
  event.sender.sendToFrame(event.frameId, 'settings-update', cfg);
  k8smanager?.emit('settings-update', cfg);
  tray?.emit('settings-update', cfg);

  Electron.ipcMain.emit('k8s-restart-required');
});

// Set up certificate handling for system certificates on Windows and macOS
Electron.app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  if (error === 'net::ERR_CERT_INVALID') {
    // If we're getting *this* particular error, it means it's an untrusted cert.
    // Ask the system store.
    console.log(`Attempting to check system certificates for ${ url } (${ certificate.subjectName }/${ certificate.fingerprint })`);
    if (os.platform().startsWith('win')) {
      const certs: string[] = [];

      WinCA({
        format: WinCA.der2.pem, ondata: certs, fallback: false
      });
      for (const cert of certs) {
        // For now, just check that the PEM data matches exactly; this is
        // probably a little more strict than necessary, but avoids issues like
        // an attacker generating a cert with the same serial.
        if (cert === certificate.data) {
          console.log(`Accepting system certificate for ${ certificate.subjectName } (${ certificate.fingerprint })`);
          // eslint-disable-next-line node/no-callback-literal
          callback(true);

          return;
        }
      }
    } else if (os.platform() === 'darwin') {
      for (const cert of MacCA.all(MacCA.der2.pem)) {
        // For now, just check that the PEM data matches exactly; this is
        // probably a little more strict than necessary, but avoids issues like
        // an attacker generating a cert with the same serial.
        if (cert === certificate.data) {
          console.log(`Accepting system certificate for ${ certificate.subjectName } (${ certificate.fingerprint })`);
          // eslint-disable-next-line node/no-callback-literal
          callback(true);

          return;
        }
      }
    }
  }

  console.log(`Not handling certificate error ${ error } for ${ url }`);

  // eslint-disable-next-line node/no-callback-literal
  callback(false);
});

Electron.ipcMain.on('k8s-state', (event) => {
  event.returnValue = k8smanager.state;
});

Electron.ipcMain.handle('current-port', event => k8smanager.port);

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
        (k8smanager.port) !== cfg.kubernetes.port)) {
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
  if (cfg.kubernetes.port !== k8smanager.port) {
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
  if (k8smanager) {
    window.send('k8s-versions', await k8smanager.availableVersions);
  }
});

Electron.ipcMain.on('k8s-progress', () => {
  if (k8smanager) {
    window.send('k8s-progress', k8smanager.progress);
  }
});

Electron.ipcMain.handle('service-fetch', (event, namespace) => {
  return k8smanager?.listServices(namespace);
});

Electron.ipcMain.handle('service-forward', async(event, service, state) => {
  if (state) {
    await k8smanager.forwardPort(service.namespace, service.name, service.port);
  } else {
    await k8smanager.cancelForward(service.namespace, service.name, service.port);
  }
});

/**
 * Check if an executable has been installed for the user, and emits the result
 * on the 'install-state' channel, as either true (has been installed), false
 * (not installed, but can be), or null (install unavailable, e.g. because a
 * different executable already exists).
 * @param {string} name The name of the executable, e.g. "kubectl", "helm".
 * @return {Promise<[boolean|null, string|null]>}
 *   first value: The state of the installable binary:
 *     true: the symlink exists, and points to a file we control
 *     false: the target file does not exist (so a symlink can be created)
 *     null: a file exists, and is either not a symlink, or points to a non-rd file
 *   second value: The reason for a null first value, or the actual error encountered when trying to link
 */
async function refreshInstallState(name: string): Promise<[boolean | null, string | null]> {
  const linkPath = path.join('/usr/local/bin', name);
  const desiredPath = await resources.executable(name);
  const [err, dest] = await new Promise((resolve) => {
    fs.readlink(linkPath, (err, dest) => {
      resolve([err, dest]);
    });
  });

  if (!err) {
    console.log(`refreshInstallState: readlink(${ linkPath }) => path ${ dest }`);
  } else if (err.code === 'ENOENT') {
    console.log(`refreshInstallState: ${ linkPath } doesn't exist`);
  } else {
    console.log(`refreshInstallState: readlink(${ linkPath }) => error ${ err }`);
  }
  if (desiredPath === dest) {
    return [true, null];
  } else if (err) {
    switch (err.code) {
    case 'ENOENT':
      return [false, null];
    case 'EINVAL':
      return [null, `${ linkPath } exists and is not a symbolic link`];
    default:
      return [null, `Can't link to ${ linkPath }: err`];
    }
  } else {
    return [null, `${ linkPath } is already linked to ${ dest }`];
  }
}

Electron.ipcMain.on('install-state', async(event, name) => {
  event.reply('install-state', name, ...await refreshInstallState(name));
});

Electron.ipcMain.on('install-set', async(event, name, newState) => {
  if (newState || (await refreshInstallState(name))[0]) {
    const err = await linkResource(name, newState);

    if (err) {
      event.reply('install-state', name, null);
    } else {
      event.reply('install-state', name, ...(await refreshInstallState(name)));
    }
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
    tray.emit('k8s-check-state', state);
    window.send('k8s-check-state', state);
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
