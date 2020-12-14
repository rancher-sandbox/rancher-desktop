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

ipcMain.on('k8s-reset', (event, arg) => {
  if (arg === 'Reset Kubernetes to default') {
    // If not in a place to restart than skip it
    if (k8smanager.state != K8s.State.STARTED && k8smanager.state != K8s.State.STOPPED) {
      return;
    }
    k8smanager.stop()
      .then((code) => {
        console.log(`Stopped minikube with code ${code}`);
        console.log(`Deleting minikube to reset...`);
        try {
          event.reply('k8s-check-state', k8smanager.state);
        } catch (err) {
          console.log(err);
        }
      })
      .then(() => {
        return k8smanager.del();
      })
      .then((code) => {
        console.log(`Deleted minikube to reset exited with code ${code}`);
      })
      .then(() => {
        // The desired Kubernetes version might have changed
        k8smanager = newK8sManager(cfg.kubernetes);
      })
      .then(() => {
        return k8smanager.start();
      })
      .then((code) => {
        try {
          event.reply('k8s-check-state', k8smanager.state);
        } catch (err) {
          console.log(err);
        }
        console.log(`Starting minikube exited with code ${code}`);
      }, startfailed);
  }
})

ipcMain.on('k8s-restart', (event) => {
  if (k8smanager.state != K8s.State.STARTED && k8smanager.state != K8s.State.STOPPED) {
    return;
  }

  if (k8smanager.state === K8s.State.STOPPED) {
    k8smanager.start().then((code) => {
      console.log(`3: Child exited with code ${code}`);
    }, startfailed);
  } else if (k8smanager.state === K8s.State.STARTED) {
    k8smanager.stop()
      .then(() => {
        // The desired Kubernetes version might have changed
        k8smanager = newK8sManager(cfg.kubernetes);
      })
      .then(() => { return k8smanager.start() })
      .then(() => {
        try {
          event.reply('k8s-check-state', k8smanager.state);
        } catch (err) {
          console.log(err);
        }
      }, startfailed);
  }
})

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
