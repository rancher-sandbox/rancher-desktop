'use strict';

// This import is for the tray found in the menu bar (upper right on macos or
// lower right on Windows).

const { Tray, Menu } = require('electron')

let trayMenu = null

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

// A clone of the template that holds the current state.
let currentContextMenuTemplate = JSON.parse(JSON.stringify(contextMenuTemplate));

function init() {
    trayMenu = new Tray('./resources/icons/logo-square.png')

    trayMenu.setToolTip('Rancher Desktop')
    let contextMenu = Menu.buildFromTemplate(contextMenuTemplate)
    trayMenu.setContextMenu(contextMenu)
}

function k8sStarted() {
    currentContextMenuTemplate[0].label = 'Kubernetes is running'
    currentContextMenuTemplate[0].icon = './resources/icons/kubernetes-icon-color.png'
    let contextMenu = Menu.buildFromTemplate(currentContextMenuTemplate)
    trayMenu.setContextMenu(contextMenu)
}

function k8sStopping() {
    currentContextMenuTemplate[0].label = 'Kubernetes is shutting down'
    currentContextMenuTemplate[0].icon = './resources/icons/kubernetes-icon-black.png'
    let contextMenu = Menu.buildFromTemplate(currentContextMenuTemplate)
    trayMenu.setContextMenu(contextMenu)
}

exports.init = init;
exports.k8sStarted = k8sStarted;
exports.k8sStopping = k8sStopping;