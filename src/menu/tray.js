'use strict';

// This import is for the tray found in the menu bar (upper right on macos or
// lower right on Windows).

const { app, Tray, Menu } = require('electron')
const window = require('../window/window.js')


let trayMenu = null

let contextMenuTemplate = [
    { label: 'Kubernetes is starting',
      type: 'normal',
      icon: './resources/icons/kubernetes-icon-black.png',
    },
    { type: 'separator' },
    { label: 'Preferences',
      type: 'normal',
      click: async () => {
        window.createWindow();
        app.dock.show()}
    },
    { type: 'separator' },
    { label: 'Quit Rancher Desktop',
      role: 'quit',
      type: 'normal'
    }
]

// A clone of the template that holds the current state.
let currentContextMenuTemplate = JSON.parse(JSON.stringify(contextMenuTemplate));

function init() {
    trayMenu = new Tray('./resources/icons/logo-square-bw.png')

    trayMenu.setToolTip('Rancher Desktop')
    let contextMenu = Menu.buildFromTemplate(contextMenuTemplate)
    trayMenu.setContextMenu(contextMenu)
}

function k8sStarted() {
    currentContextMenuTemplate[0].label = 'Kubernetes is running'
    currentContextMenuTemplate[0].icon = './resources/icons/kubernetes-icon-color.png'
    let contextMenu = Menu.buildFromTemplate(currentContextMenuTemplate)
    trayMenu.setContextMenu(contextMenu)
    trayMenu.setImage('./resources/icons/logo-square.png')
}

function k8sStopping() {
    currentContextMenuTemplate[0].label = 'Kubernetes is shutting down'
    currentContextMenuTemplate[0].icon = './resources/icons/kubernetes-icon-black.png'
    let contextMenu = Menu.buildFromTemplate(currentContextMenuTemplate)
    trayMenu.setContextMenu(contextMenu)
    trayMenu.setImage('./resources/icons/logo-square-bw.png')
}

exports.init = init;
exports.k8sStarted = k8sStarted;
exports.k8sStopping = k8sStopping;