const { app, BrowserWindow, dialog } = require('electron')
const { spawn } = require('child_process');
const prompt = require('electron-prompt');
const os = require('os');
const Minikube = require('./src/k8s-engine/minikube.js')
const tray = require('./src/menu/tray.js')
// TODO: rewrite in typescript. This was just a quick proof of concept.

app.setName("Rancher Desktop")

let win

function createWindow () {
  win = new BrowserWindow({
    width: 600,
    height: 100,
    webPreferences: {
      nodeIntegration: true
    }
  })

  // The front end needs to be rewritten in something far better
  win.loadFile('index.html')
}

app.whenReady().then(() => {

    tray.init();

    createWindow();

    Minikube.start((code) => {
        console.log(`Child exited with code ${code}`);
        tray.k8sStarted();
        win.loadFile('index-started.html');
    });


// prompt({
//   title: 'Prompt example',
//   label: 'System password',
//   inputAttrs: {
//       type: 'password'
//   },
//   type: 'input'
// })
// .then((r) => {
//   if(r === null) {
//       console.log('user cancelled');
//   } else {
//       console.log('result', r);
//   }
// })
// .catch(console.error);
})

let gone = false
app.on('before-quit', (event) => {
  if (gone) return
  win.loadFile('index-quit.html')
  event.preventDefault();
  tray.k8sStopping()

  Minikube.stop((code) => {
    console.log(`Child exited with code ${code}`);
    gone = true
    app.quit()
  });
})


app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
