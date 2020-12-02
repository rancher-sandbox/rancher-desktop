const { app, ipcMain, dialog } = require('electron');
const settings = require('./src/config/settings.js');
const tray = require('./src/menu/tray.js');
const window = require('./src/window/window.js');
const K8s = require('./src/k8s-engine/k8s.js');
// TODO: rewrite in typescript. This was just a quick proof of concept.

app.setName("Rancher Desktop");

let k8smanager;

app.whenReady().then(() => {

  tray.init();

  // TODO: Check if first install and start welcome screen
  // TODO: Check if new version and provide window with details on changes

  let cfg = settings.init();
  console.log(cfg);
  k8smanager = K8s.factory(cfg.kubernetes);

  k8smanager.start().then((code) => {
    console.log(`1: Child exited with code ${code}`);
    if (k8smanager.state === K8s.State.STARTED) {
      tray.k8sStarted();
    }
  }, startfailed);

  window.createWindow();
})

let gone = false;
app.on('before-quit', (event) => {
  if (gone) return;
  event.preventDefault();
  tray.k8sStopping();

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

ipcMain.on('k8s-state', (event) => {
  event.returnValue = k8smanager.state;
});

ipcMain.on('k8s-reset', (event, arg) => {
  if (arg === 'Reset Kubernetes to default') {
    // If not in a place to restart than skip it
    if (k8smanager.state != K8s.State.STARTED && k8smanager.state != K8s.State.STOPPED) {
      return;
    }
    tray.k8sStopping();
    k8smanager.stop()
      .then((code) => {
        console.log(`Stopped minikube with code ${code}`);
        tray.k8sRestarting();
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
        return k8smanager.start();
      })
      .then((code) => {
        tray.k8sStarted();
        try {
          event.reply('k8s-check-state', k8smanager.state);
        } catch (err) {
          console.log(err);
        }
        console.log(`Starting minikube exited with code ${code}`);
      }, startfailed);
  }
})

ipcMain.on('k8s-restart', () => {
  if (k8smanager.state != K8s.State.STARTED && k8smanager.state != K8s.State.STOPPED) {
    return;
  }

  if (k8smanager.state === K8s.State.STOPPED) {
    k8smanager.start().then((code) => {
      console.log(`3: Child exited with code ${code}`);
      tray.k8sStarted();
    }, startfailed);
  } else if (k8smanager.state === K8s.State.STARTED) {
    tray.k8sStopping();
    k8smanager.stop()
      .then(() => {
        tray.k8sRestarting();
      })
      .then(() => { k8smanager.start() })
      .then(() => {
        tray.k8sStarted();
      }, startfailed);
  }
})

function startfailed(code) {
  dialog.showErrorBox("Error Starting Kuberentes", "Kubernetes was unable to start with the following exit code: " + code);
}