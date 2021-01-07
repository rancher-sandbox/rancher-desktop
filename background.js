'use strict';

const { app, ipcMain, dialog, protocol } = require('electron');
const deepmerge = require('deepmerge');
const fs = require('fs');
const path = require('path');
const settings = require('./src/config/settings.js');
const tray = require('./src/menu/tray.js');
const window = require('./src/window/window.js');
const K8s = require('./src/k8s-engine/k8s.js');
const resources = require('./src/resources');
// TODO: rewrite in typescript. This was just a quick proof of concept.

app.setName("Rancher Desktop");

let k8smanager;
let cfg;

// Scheme must be registered before the app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true } }
]);

app.whenReady().then(() => {

  tray.init();

  // TODO: Check if first install and start welcome screen
  // TODO: Check if new version and provide window with details on changes

  cfg = settings.init();
  console.log(cfg);
  k8smanager = newK8sManager(cfg.kubernetes);

  k8smanager.start().then((code) => {
    console.log(`1: Child exited with code ${code}`);
  }, handleFailure);

  // Set up protocol handler for app://
  // This is needed because in packaged builds we'll not be allowed to access
  // file:// URLs for our resources.
  protocol.registerFileProtocol('app', (request, callback) => {
    let relPath = (new URL(request.url)).pathname;
    relPath = decodeURI(relPath) // Needed in case URL contains spaces
    // Default to the path for development mode, running out of the source tree.
    let result = { path: path.join(app.getAppPath(), ".webpack", relPath) };
    if (app.isPackaged) {
      result.path = path.join(app.getAppPath(), relPath);
    }
    let mimeType = {
      css: 'text/css',
      html: 'text/html',
      js: 'text/javascript',
      json: 'application/json',
      png: 'image/png',
      svg: 'image/svg+xml',
    }[path.extname(relPath).toLowerCase().replace(/^\./, '')];
    if (mimeType !== undefined) {
      result.mimeType = mimeType;
    }
    callback(result);
  });
  window.openPreferences();
})

let gone = false;
app.on('before-quit', (event) => {
  if (gone) return;
  event.preventDefault();

  let stopHandler = (code) => {
      console.log(`2: Child exited with code ${code}`);
      gone = true;
    };
  k8smanager.stop()
    .then(stopHandler,
      (ex) => {
        stopHandler(ex.errorCode),
        handleFailure(ex);
      })
    .finally(app.quit);
})

// TODO: Handle non-darwin OS
app.on('window-all-closed', () => {
  app.dock.hide();
  // On macos use the tray icon menu in the global menubar to quit the app.
  if (process.platform !== 'darwin') {
    app.quit();
  }
})

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  window.openPreferences();
});

ipcMain.on('settings-read', (event) => {
  event.returnValue = cfg;
});

ipcMain.handle('settings-write', async (event, arg) => {
  cfg = deepmerge(cfg, arg);
  settings.save(cfg);
  event.sender.sendToFrame(event.frameId, 'settings-update', cfg);
});

ipcMain.on('k8s-state', (event) => {
  event.returnValue = k8smanager.state;
});

ipcMain.on('k8s-reset', async (event, arg) => {
  try {
    if (arg === 'Reset Kubernetes to default') {
      // If not in a place to restart than skip it
      if (k8smanager.state != K8s.State.STARTED && k8smanager.state != K8s.State.STOPPED) {
        return;
      }
      let code = await k8smanager.stop();
      console.log(`Stopped minikube with code ${code}`);
      console.log(`Deleting minikube to reset...`);
      try {
        event.reply('k8s-check-state', k8smanager.state);
      } catch (err) {
        console.log(err);
      }

      code = await k8smanager.del();
      console.log(`Deleted minikube to reset exited with code ${code}`);

      // The desired Kubernetes version might have changed
      k8smanager = newK8sManager(cfg.kubernetes);

      code = await k8smanager.start();
      try {
        event.reply('k8s-check-state', k8smanager.state);
      } catch (err) {
        console.log(err);
      }
      console.log(`Starting minikube exited with code ${code}`);
    }
  } catch (ex) {
    handleFailure(ex);
  }
});

ipcMain.on('k8s-restart', async (event) => {
  if (k8smanager.state != K8s.State.STARTED && k8smanager.state != K8s.State.STOPPED) {
    return;
  }

  try {
    if (k8smanager.state === K8s.State.STOPPED) {
      let code = await k8smanager.start();
      console.log(`3: Child exited with code ${code}`);
    } else if (k8smanager.state === K8s.State.STARTED) {
      await k8smanager.stop();
      // The desired Kubernetes version might have changed
      k8smanager = newK8sManager(cfg.kubernetes);

      await k8smanager.start();
      try {
        event.reply('k8s-check-state', k8smanager.state);
      } catch (err) {
        console.log(err);
      }
    }
  } catch (ex) {
    handleFailure(ex);
  }
});

/**
 * Check if an executable has been installed for the user, and emits the result
 * on the 'install-state' channel, as either true (has been installed), false
 * (not installed, but can be), or null (install unavailable, e.g. because a
 * different executable already exists).
 * @param {string} name The name of the executable, e.g. "kubectl", "helm".
 * @returns {boolean?} The state of the installable binary.
 */
async function refreshInstallState(name) {
  const linkPath = path.join("/usr/local/bin", name);
  const desiredPath = resources.executable(name);
  let [err, dest] = await new Promise((resolve) => {
    fs.readlink(linkPath, (err, dest) => { resolve([err, dest]) });
  });
  console.log(`Reading ${linkPath} got error ${err?.code} result ${dest}`);
  if (err?.code === "ENOENT") {
    return false;
  } else if (desiredPath === dest) {
    return true;
  }
  return null;
}

ipcMain.on('install-state', async (event, name) => {
  let state = await refreshInstallState(name);
  event.reply('install-state', name, state);
});
ipcMain.on('install-set', async (event, name, newState) => {
  const linkPath = path.join("/usr/local/bin", name);
  if (newState) {
    let err = await new Promise((resolve) => {
      fs.symlink(resources.executable(name), linkPath, 'file', resolve);
    });
    if (err) {
      console.error(`Error creating symlink for ${linkPath}`, err);
      event.reply('install-state', name, null);
    } else {
      event.reply('install-state', name, await refreshInstallState(name));
    }
  } else {
    if (await refreshInstallState(name)) {
      let err = new Promise((resolve) => { fs.unlink(linkPath, resolve) });
      if (err) {
        console.error(`Error unlinking symlink for ${linkPath}`, err);
        event.reply('install-state', name, null);
      } else {
        event.reply('install-state', name, await refreshInstallState(name));
      }
    }
  }
})

function handleFailure(payload) {
  let errorCode, message, titlePart = null;
  if (typeof (payload) == "number") {
    errorCode = payload;
    message = "Kubernetes was unable to start with the following exit code: " + payload;
  } else {
    errorCode = payload.errorCode;
    message = payload.message;
    titlePart = payload.context
  }
  console.log(`Kubernetes was unable to start with exit code: ${errorCode}`)
  titlePart = titlePart || "Starting Kubernetes"
  dialog.showErrorBox(`Error ${titlePart}`, message);
}

function newK8sManager(cfg) {
  let mgr = K8s.factory(cfg);
  mgr.on("state-changed", (state) => {
    tray.k8sStateChanged(state);
  });

  return mgr;
}
