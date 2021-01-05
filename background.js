const { app, ipcMain, dialog } = require('electron');
const deepmerge = require('deepmerge');
const settings = require('./src/config/settings.js');
const tray = require('./src/menu/tray.js');
const window = require('./src/window/window.js');
const K8s = require('./src/k8s-engine/k8s.js');
// TODO: rewrite in typescript. This was just a quick proof of concept.

app.setName("Rancher Desktop");

let k8smanager;
let cfg;

app.whenReady().then(() => {

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

  let stopHandler = (code) => {
      console.log(`2: Child exited with code ${code}`);
      gone = true;
    };
  k8smanager.stop()
    .then(stopHandler,
      (ex) => {
        stopHandler(ex.errorCode),
        startfailed(ex);
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

function startfailed(payload) {
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
