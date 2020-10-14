const { app, BrowserWindow, Menu, Tray } = require('electron')
const { spawn } = require('child_process');

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

  // TODO: Minikube handling should be completely overhaulded which includes a
  // package, handling for non-mac, status detection, and more.
  // TODO: Use MINIKUBE_HOME to set storing the config separately from the
  // standard one. This should reside in the right spot on each system.
  // TODO: Set it up so that an exit during startup does not cause issues.
  const bat = spawn('minikube', ['start', '-p', 'rancher-desktop', '--driver', 'hyperkit', '--container-runtime', 'containerd']);

  bat.stdout.on('data', (data) => {
      console.log(data.toString());
  });

  bat.stderr.on('data', (data) => {
      console.error(data.toString());
  });

  bat.on('exit', (code) => {
      console.log(`Child exited with code ${code}`);
      contextMenuTemplate[0].label = 'Kubernetes is running'
      contextMenuTemplate[0].icon = './resources/icons/kubernetes-icon-color.png'
      let contextMenu = Menu.buildFromTemplate(contextMenuTemplate)
      tray.setContextMenu(contextMenu)
      win.loadFile('index-started.html')
  });
}

let tray = null


app.whenReady().then(() => {

  tray = new Tray('./resources/icons/logo-square.png')
  
  tray.setToolTip('Rancher Desktop')
  let contextMenu = Menu.buildFromTemplate(contextMenuTemplate)
  tray.setContextMenu(contextMenu)

  createWindow()

  sub()
})

let gone = false
app.on('before-quit', (event) => {
  if (gone) return
  win.loadFile('index-quit.html')
  event.preventDefault();
  contextMenuTemplate[0].label = 'Kubernetes is shutting down'
  contextMenuTemplate[0].icon = './resources/icons/kubernetes-icon-black.png'
  let contextMenu = Menu.buildFromTemplate(contextMenuTemplate)
  tray.setContextMenu(contextMenu)

  // TODO: There MUST be a better way to exit. Do that.
  const bat = spawn('minikube', ['stop', '-p', 'rancher-desktop']);

  bat.stdout.on('data', (data) => {
    console.log(data.toString());
  });

  bat.stderr.on('data', (data) => {
    console.error(data.toString());
  });

  bat.on('exit', (code) => {
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
