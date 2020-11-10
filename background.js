const { app, ipcMain } = require('electron')
const Minikube = require('./src/k8s-engine/minikube.js')
const settings = require('./src/config/settings.js')
const tray = require('./src/menu/tray.js')
const window = require('./src/window/window.js')
// TODO: rewrite in typescript. This was just a quick proof of concept.

app.setName("Rancher Desktop")



app.whenReady().then(() => {

    tray.init();

    // TODO: Check if first install and start welcome screen
    // TODO: Check if new version and provide window with details on changes

    let cfg = settings.init()
    console.log(cfg)

    Minikube.start(cfg.kubernetes, (code) => {
        console.log(`Child exited with code ${code}`);
        tray.k8sStarted();
    });

    window.createWindow();
})

let gone = false
app.on('before-quit', (event) => {
  if (gone) return
  event.preventDefault();
  tray.k8sStopping()

  Minikube.stop((code) => {
    console.log(`Child exited with code ${code}`);
    gone = true
    app.quit()
  });
})

// TODO: Handle non-darwin OS
app.on('window-all-closed', () => {
  app.dock.hide();
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

ipcMain.on('k8s-reset', (event, arg) => {
  if (arg === 'Reset Kubernetes to default') {

    tray.k8sStopping()
    Minikube.stop((code) => {
      console.log(`Stopped minikube with code ${code}`)
      tray.k8sRestarting()
      Minikube.del((code2) => {
        console.log(`Deleting minikube to reset exited with code ${code2}`)
        let cfg = settings.init()
        Minikube.start(cfg.kubernetes, (code3) => {
          tray.k8sStarted();
          event.sender.send('k8s-reset-reply', 'done')
          console.log(`Starting minikube exited with code ${code3}`)
        })
      })
    })
  }
})