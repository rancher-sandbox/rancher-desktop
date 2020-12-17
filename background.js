const { app, ipcMain, dialog, protocol } = require('electron');
const deepmerge = require('deepmerge');
const path = require('path');
const url = require('url');
const settings = require('./src/config/settings.js');
const tray = require('./src/menu/tray.js');
const window = require('./src/window/window.js');
const K8s = require('./src/k8s-engine/k8s.js');
// TODO: rewrite in typescript. This was just a quick proof of concept.

app.setName("Rancher Desktop");

let k8smanager;
let cfg;

app.whenReady().then(() => {

  // Set up protocol handler for app://
  // This is needed because in packaged builds we'll not be allowed to access
  // file:// URLs for our resources.
  protocol.registerFileProtocol('app', (request, callback) => {
    let relPath = (new URL(request.url)).pathname;
    // Default to the path for development mode, running out of the source tree.
    let absPath = path.join(app.getAppPath(), ".webpack", relPath);
    if (app.isPackaged) {
      // electron-forge replaces MAIN_WINDOW_WEBPACK_ENTRY with the path to
      // the index.html, but we want to find top of the .asar if available.
      /*global MAIN_WINDOW_WEBPACK_ENTRY */ // Quiet ESLint warning
      let rootURL = MAIN_WINDOW_WEBPACK_ENTRY.replace(/\.webpack\/.*$/, '');
      let root = url.fileURLToPath(rootURL);
      absPath = path.join(root, ".webpack", relPath);
    }
    callback({ path: absPath });
  });

  tray.init();

  // TODO: Check if first install and start welcome screen
  // TODO: Check if new version and provide window with details on changes

  cfg = settings.init();
  console.log(cfg);
  k8smanager = newK8sManager(cfg.kubernetes);

  k8smanager.start().then((code) => {
    console.log(`1: Child exited with code ${code}`);
  }, startfailed);

  window.createWindow();
})

let gone = false;
app.on('before-quit', (event) => {
  if (gone) return;
  event.preventDefault();

  k8smanager.stop()
    .finally((code) => {
      console.log(`2: Child exited with code ${code}`);
      gone = true;
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
    startfailed(ex);
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
    startfailed(ex);
  }
});

function startfailed(code) {
  dialog.showErrorBox("Error Starting Kuberentes", "Kubernetes was unable to start with the following exit code: " + code);
}

function newK8sManager(cfg) {
  let mgr = K8s.factory(cfg);
  mgr.on("state-changed", (state) => {
    tray.k8sStateChanged(state);
  });

  return mgr;
}
