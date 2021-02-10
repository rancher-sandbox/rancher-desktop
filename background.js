'use strict';

const fs = require('fs');
const path = require('path');
const {
  app, ipcMain, dialog, protocol
} = require('electron');
const deepmerge = require('deepmerge');
const settings = require('./src/config/settings.js');
const { Tray } = require('./src/menu/tray.js');
const window = require('./src/window/window.js');
const K8s = require('./src/k8s-engine/k8s.js');
const resources = require('./src/resources');
// TODO: rewrite in typescript. This was just a quick proof of concept.

app.setName('Rancher Desktop');

let k8smanager;
let cfg;
let tray = null;
let gone = false; // when true indicates app is shutting down

// Scheme must be registered before the app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true } },
]);

app.whenReady().then(async() => {
  try {
    tray = new Tray();
  } catch (e) {
    console.log(`\nERROR: ${ e.message }`);
    gone = true;
    app.quit();

    return;
  }
  tray.on('window-preferences', () => {
    window.openPreferences(); app.dock.show();
  });
  tray.on('window-dashboard', async() => {
    window.openDashboard(await k8smanager.homesteadPort());
  });

  // TODO: Check if first install and start welcome screen
  // TODO: Check if new version and provide window with details on changes

  if (!app.isPackaged) {
    // Install devtools; no need to wait for it to complete.
    const { default: installExtension, VUEJS_DEVTOOLS } = require('electron-devtools-installer');

    installExtension(VUEJS_DEVTOOLS);
  }
  if (await settings.isFirstRun()) {
    await Promise.all([
      linkResource('kubectl', true),
      linkResource('helm', true),
    ]);
  }
  try {
    cfg = settings.init();
  } catch (err) {
    gone = true;
    app.quit();

    return;
  }

  console.log(cfg);
  tray.emit('settings-update', cfg);
  k8smanager = newK8sManager(cfg.kubernetes);

  k8smanager.start().catch(handleFailure);

  // Set up protocol handler for app://
  // This is needed because in packaged builds we'll not be allowed to access
  // file:// URLs for our resources.
  protocol.registerFileProtocol('app', (request, callback) => {
    let relPath = (new URL(request.url)).pathname;

    relPath = decodeURI(relPath); // Needed in case URL contains spaces
    // Default to the path for development mode, running out of the source tree.
    const result = { path: path.join(app.getAppPath(), 'app', relPath) };
    const mimeType = {
      css:  'text/css',
      html: 'text/html',
      js:   'text/javascript',
      json: 'application/json',
      png:  'image/png',
      svg:  'image/svg+xml',
    }[path.extname(relPath).toLowerCase().replace(/^\./, '')];

    if (mimeType !== undefined) {
      result.mimeType = mimeType;
    }
    callback(result);
  });
  window.openPreferences();
});

app.on('before-quit', (event) => {
  if (gone) {
    return;
  }
  event.preventDefault();

  const stopHandler = (code) => {
    console.log(`2: Child exited with code ${ code }`);
    gone = true;
  };

  k8smanager.stop()
    .then(stopHandler,
      (ex) => {
        stopHandler(ex.errorCode);
        handleFailure(ex);
      })
    .finally(app.quit);
});

// TODO: Handle non-darwin OS
app.on('window-all-closed', () => {
  app.dock.hide();
  // On macos use the tray icon menu in the global menubar to quit the app.
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  window.openPreferences();
});

ipcMain.on('settings-read', (event) => {
  event.returnValue = cfg;
});

ipcMain.handle('settings-write', (event, arg) => {
  cfg = deepmerge(cfg, arg);
  settings.save(cfg);
  event.sender.sendToFrame(event.frameId, 'settings-update', cfg);
  k8smanager?.emit('settings-update', cfg);
  tray?.emit('settings-update', cfg);
});

ipcMain.on('k8s-state', (event) => {
  event.returnValue = k8smanager.state;
});

ipcMain.on('k8s-reset', async(event, arg) => {
  try {
    if (arg !== 'Reset Kubernetes to default') {
      return;
    }
    // If not in a place to restart than skip it
    if (![K8s.State.STARTED, K8s.State.READY, K8s.State.STOPPED].includes(k8smanager.state)) {
      return;
    }
    let code = await k8smanager.stop();

    console.log(`Stopped minikube with code ${ code }`);
    console.log('Deleting minikube to reset...');

    code = await k8smanager.del();
    console.log(`Deleted minikube to reset exited with code ${ code }`);

    // The desired Kubernetes version might have changed
    k8smanager = newK8sManager(cfg.kubernetes);

    await k8smanager.start();
  } catch (ex) {
    handleFailure(ex);
  }
});

ipcMain.on('k8s-restart', async() => {
  try {
    switch (k8smanager.state) {
    case K8s.State.STOPPED:
      await k8smanager.start();
      break;
    case K8s.State.STARTED:
    case K8s.State.READY:
      await k8smanager.stop();
      // The desired Kubernetes version might have changed
      k8smanager = newK8sManager(cfg.kubernetes);

      await k8smanager.start();
      break;
    }
  } catch (ex) {
    handleFailure(ex);
  }
});

ipcMain.handle('service-fetch', async (event, namespace) => {
  return await k8smanager?.listServices(namespace);
});

ipcMain.handle('service-forward', async (event, service, state) => {
  if (state) {
    await k8smanager.forwardPort(service.namespace, service.name, service.port);
  } else {
    await k8smanager.cancelForward(service.namespace, service.name, service.port);
  }
});

const adjustNameWithDir = {
  helm:    path.join('bin', 'helm'),
  kubectl: path.join('bin', 'kubectl'),
};

function fixedSourceName(name) {
  return adjustNameWithDir[name] || name;
}

/**
 * Check if an executable has been installed for the user, and emits the result
 * on the 'install-state' channel, as either true (has been installed), false
 * (not installed, but can be), or null (install unavailable, e.g. because a
 * different executable already exists).
 * @param {string} name The name of the executable, e.g. "kubectl", "helm".
 * @returns {boolean?} The state of the installable binary.
 */
async function refreshInstallState(name) {
  const linkPath = path.join('/usr/local/bin', name);
  const desiredPath = await resources.executable(fixedSourceName(name));
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
  if (err?.code === 'ENOENT') {
    return false;
  } else if (desiredPath === dest) {
    return true;
  }

  return null;
}

ipcMain.on('install-state', async(event, name) => {
  const state = await refreshInstallState(name);

  event.reply('install-state', name, state);
});
ipcMain.on('install-set', async(event, name, newState) => {
  if (newState || await refreshInstallState(name)) {
    const err = await linkResource(name, newState);

    if (err) {
      event.reply('install-state', name, null);
    } else {
      event.reply('install-state', name, await refreshInstallState(name));
    }
  }
});

/**
 * Do a factory reset of the application.  This will stop the currently running
 * cluster (if any), and delete all of its data.  This will also remove any
 * rancher-desktop data, and restart the application.
 */
ipcMain.on('factory-reset', async() => {
  // Clean up the Kubernetes cluster
  await k8smanager.factoryReset();
  // Unlink binaries
  for (const name of ['helm', 'kubectl']) {
    ipcMain.emit('install-set', { reply: () => { } }, name, false);
  }
  // Remove app settings
  await settings.clear();
  // Restart
  app.relaunch();
  app.quit();
});

/**
 * assume sync activities aren't going to be costly for a UI app.
 * @param {String} name -- basename of the resource to link
 * @param {Boolean} state -- true to symlink, false to delete
 * @returns {Promise<Error?>}
 */
async function linkResource(name, state) {
  const linkPath = path.join('/usr/local/bin', name);

  if (state) {
    const err = await new Promise((resolve) => {
      fs.symlink(resources.executable(fixedSourceName(name)), linkPath, 'file', resolve);
    });

    if (err) {
      console.error(`Error creating symlink for ${ linkPath }: ${ err.message }`);

      return err;
    }
  } else {
    const err = await new Promise((resolve) => {
      fs.unlink(linkPath, resolve);
    });

    if (err) {
      console.error(`Error unlinking symlink for ${ linkPath }: ${ err.message }`);

      return err;
    }
  }

  return null;
}

function handleFailure(payload) {
  let { errorCode, message, context: titlePart } = payload;

  if (typeof (payload) === 'number') {
    errorCode = payload;
    message = `Kubernetes was unable to start with the following exit code: ${ payload }`;
  }
  console.log(`Kubernetes was unable to start with exit code: ${ errorCode }`);
  titlePart = titlePart || 'Starting Kubernetes';
  dialog.showErrorBox(`Error ${ titlePart }`, message);
}

function newK8sManager(cfg) {
  const mgr = K8s.factory(cfg);

  mgr.on('state-changed', (state) => {
    tray.emit('k8s-check-state', state);
    window.send('k8s-check-state', state);

    if (state !== K8s.State.READY) {
      window.closeDashboard();
    }
  });

  mgr.on('service-changed', services => {
    window.send('service-changed', services);
  });

  return mgr;
}
