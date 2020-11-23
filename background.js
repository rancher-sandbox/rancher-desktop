const { app, ipcMain } = require('electron')
const Minikube = require('./src/k8s-engine/minikube.js')
const settings = require('./src/config/settings.js')
const tray = require('./src/menu/tray.js')
const window = require('./src/window/window.js')
const K8s = require('./src/k8s-engine/k8s.js')
// TODO: rewrite in typescript. This was just a quick proof of concept.

app.setName("Rancher Desktop")

let K8sState = K8s.State.STOPPED

app.whenReady().then(() => {

    tray.init();

    // TODO: Check if first install and start welcome screen
    // TODO: Check if new version and provide window with details on changes

    let cfg = settings.init()
    console.log(cfg)

    K8sState = K8s.State.STARTING
    Minikube.start(cfg.kubernetes).then((code) => {
        console.log(`Child exited with code ${code}`);
        K8sState = K8s.State.STARTED
        tray.k8sStarted();
    });

    window.createWindow();
})

let gone = false
app.on('before-quit', (event) => {
  if (gone) return
  event.preventDefault();
  tray.k8sStopping()

  K8sState = K8s.State.STOPPING
  Minikube.stop()
    .finally((code) => {
      console.log(`Child exited with code ${code}`);
      K8sState = K8s.State.STOPPED
      gone = true
    })
    .finally(app.quit)
})

// TODO: Handle non-darwin OS
app.on('window-all-closed', () => {
  app.dock.hide();
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

ipcMain.on('k8s-state', (event) => {
  event.returnValue = K8sState;
});

ipcMain.on('k8s-reset', (event, arg) => {
  if (arg === 'Reset Kubernetes to default') {
    // If not in a place to restart than skip it
    if (K8sState != K8s.State.STARTED && K8sState != K8s.State.STOPPED) {
      return
    }
    K8sState = K8s.State.STOPPING
    tray.k8sStopping()
    Minikube.stop()
      .then((code) => {
        console.log(`Stopped minikube with code ${code}`)
        tray.k8sRestarting()
        K8sState = K8s.State.STOPPED
        console.log(`Deleting minikube to reset...`)
      })
      .then(Minikube.del)
      .then((code) => {
        console.log(`Deleted minikube to reset exited with code ${code}`)
        K8sState = K8s.State.STARTING
      })
      .then(() => {
        let cfg = settings.init()
        Minikube.start(cfg.kubernetes)
      })
      .then((code) => {
        tray.k8sStarted();
        K8sState = K8s.State.STARTED
        try {
          event.sender.send('k8s-reset-reply', 'done')
        } catch (err) {
          console.log(err)
        }
        console.log(`Starting minikube exited with code ${code}`)
      })
  }
})

ipcMain.on('k8s-restart', (event, arg) => {
  if (K8sState != K8s.State.STARTED && K8sState != K8s.State.STOPPED) {
    return
  }

  let cfg = settings.init()

  if (K8sState === K8s.State.STOPPED) {
    K8sState = K8s.State.STARTING
    Minikube.start(cfg.kubernetes).then((code) => {
        console.log(`Child exited with code ${code}`);
        K8sState = K8s.State.STARTED
        tray.k8sStarted();
    });
  } else if (K8sState === K8s.State.STARTED) {
    tray.k8sStopping()
    Minikube.stop()
      .then(() => {
        K8sState = K8s.State.STOPPED
        tray.k8sRestarting()
      })
      .then(() => { Minikube.start(cfg.kubernetes) })
      .then(() => {
        tray.k8sStarted();
        K8sState = K8s.State.STARTED
      })
  }
})