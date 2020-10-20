const { app, BrowserWindow, Menu, Tray, dialog } = require('electron')
const { spawn } = require('child_process');
const prompt = require('electron-prompt');
const os = require('os');
const Minikube = require('./src/k8s-engine/minikube.js')
// TODO: rewrite in typescript. This was just a quick proof of concept.

app.setName("Rancher Desktop")

let contextMenuTemplate = [
  { label: 'Kubernetes is starting',
    type: 'normal',
    icon: './resources/icons/kubernetes-icon-black.png',
    click: async () => {
      const { shell } = require('electron')
      await shell.openExternal('https://rancher.com/')}
  },
  { type: 'separator' },
  { label: 'Quit Rancher Desktop',
    role: 'quit',
    type: 'normal'
  }
]

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

function sub() {

  
}

let tray = null


app.whenReady().then(() => {

    tray = new Tray('./resources/icons/logo-square.png')

    tray.setToolTip('Rancher Desktop')
    let contextMenu = Menu.buildFromTemplate(contextMenuTemplate)
    tray.setContextMenu(contextMenu)

    createWindow()

    Minikube.start((code) => {
        console.log(`Child exited with code ${code}`);
        contextMenuTemplate[0].label = 'Kubernetes is running'
        contextMenuTemplate[0].icon = './resources/icons/kubernetes-icon-color.png'
        let contextMenu = Menu.buildFromTemplate(contextMenuTemplate)
        tray.setContextMenu(contextMenu)
        win.loadFile('index-started.html')
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
// })

let gone = false
app.on('before-quit', (event) => {
  if (gone) return
  win.loadFile('index-quit.html')
  event.preventDefault();
  contextMenuTemplate[0].label = 'Kubernetes is shutting down'
  contextMenuTemplate[0].icon = './resources/icons/kubernetes-icon-black.png'
  let contextMenu = Menu.buildFromTemplate(contextMenuTemplate)
  tray.setContextMenu(contextMenu)

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
