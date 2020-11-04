const { app, BrowserWindow, dialog } = require('electron')
const Minikube = require('./src/k8s-engine/minikube.js')
const settings = require('./src/config/settings.js')
const tray = require('./src/menu/tray.js')
// TODO: rewrite in typescript. This was just a quick proof of concept.

app.setName("Rancher Desktop")

let url
if (process.env.NODE_ENV === 'DEV') {
  url = 'http://localhost:8080/'
} else {
  url = `file://${process.cwd()}/dist/index.html`
}

app.whenReady().then(() => {

    tray.init();

    // TODO: Check if first install and start welcome screen
    // TODO: Check if new version and provide window with details on changes

    // TODO: Load config and if not present create first config file
    cfg = settings.init()
    console.log(cfg)

    Minikube.start(cfg.kubernetes, (code) => {
        console.log(`Child exited with code ${code}`);
        tray.k8sStarted();
    });

    let window = new BrowserWindow({width: 800, height: 600})
    window.loadURL(url)

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


// We don't need no dock icon. It's in the nav bar
// TODO: Bring back the dock icon when the settings are open.
app.dock.hide();

// TODO: Handle non-darwin OS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})