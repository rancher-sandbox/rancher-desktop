'use strict';

// This import is for the tray found in the menu bar (upper right on macos or
// lower right on Windows).

const { app, Tray, Menu } = require('electron')
const window = require('../window/window.js')


let trayMenu = null

let contextMenuItems = [
    { label: 'Kubernetes is starting',
      type: 'normal',
      icon: './resources/icons/kubernetes-icon-black.png',
    },
    { type: 'separator' },
    { label: 'Preferences',
      type: 'normal',
      click: clicked,
    },
    { type: 'separator' },
    { label: 'Quit Rancher Desktop',
      role: 'quit',
      type: 'normal'
    }
]

async function clicked() {
    window.createWindow();
    app.dock.show();
}

function init() {
    trayMenu = new Tray('./resources/icons/logo-square-bw.png')

    trayMenu.setToolTip('Rancher Desktop')
    let contextMenu = Menu.buildFromTemplate(contextMenuItems)
    trayMenu.setContextMenu(contextMenu)
}

function k8sStarted() {
    contextMenuItems[0].label = 'Kubernetes is running'
    contextMenuItems[0].icon = './resources/icons/kubernetes-icon-color.png'
    let contextMenu = Menu.buildFromTemplate(contextMenuItems)
    trayMenu.setContextMenu(contextMenu)
    trayMenu.setImage('./resources/icons/logo-square.png')
}

function k8sStopping() {
    contextMenuItems[0].label = 'Kubernetes is shutting down'
    contextMenuItems[0].icon = './resources/icons/kubernetes-icon-black.png'
    let contextMenu = Menu.buildFromTemplate(contextMenuItems)
    trayMenu.setContextMenu(contextMenu)
    trayMenu.setImage('./resources/icons/logo-square-bw.png')
}

function k8sRestarting() {
    contextMenuItems[0].label = 'Kubernetes is starting'
    contextMenuItems[0].icon = './resources/icons/kubernetes-icon-black.png'
    let contextMenu = Menu.buildFromTemplate(contextMenuItems)
    trayMenu.setContextMenu(contextMenu)
    trayMenu.setImage('./resources/icons/logo-square-bw.png')
}

exports.init = init;
exports.k8sStarted = k8sStarted;
exports.k8sStopping = k8sStopping;
exports.k8sRestarting = k8sRestarting;