'use strict';

// This import is for the tray found in the menu bar (upper right on macos or
// lower right on Windows).

const { app, Tray, Menu } = require('electron');
const window = require('../window/window.js');
const kubectl = require('../k8s-engine/kubectl.js');
const kubeconfig = require('../config/kubeconfig.js');
const k8s = require('@kubernetes/client-node');
const fs = require('fs');

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
  { label: 'Kubernetes Contexts',
    type: 'submenu',
    submenu: [],
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
  trayMenu = new Tray('./resources/icons/logo-square-bw.png');

  trayMenu.setToolTip('Rancher Desktop');

  // Discover k8s contexts
  updateContexts();

  let contextMenu = Menu.buildFromTemplate(contextMenuItems);
  trayMenu.setContextMenu(contextMenu);

  fs.watch(kubeconfig.path(), () => {
    updateContexts();
    let contextMenu = Menu.buildFromTemplate(contextMenuItems);
    trayMenu.setContextMenu(contextMenu);
  })
}

function k8sStarted() {
  contextMenuItems[0].label = 'Kubernetes is running';
  contextMenuItems[0].icon = './resources/icons/kubernetes-icon-color.png';

  // Update the contexts as this one will be added
  updateContexts();

  let contextMenu = Menu.buildFromTemplate(contextMenuItems);
  trayMenu.setContextMenu(contextMenu);
  trayMenu.setImage('./resources/icons/logo-square.png');
}

function k8sStopping() {
  contextMenuItems[0].label = 'Kubernetes is shutting down';
  contextMenuItems[0].icon = './resources/icons/kubernetes-icon-black.png';
  let contextMenu = Menu.buildFromTemplate(contextMenuItems);
  trayMenu.setContextMenu(contextMenu);
  trayMenu.setImage('./resources/icons/logo-square-bw.png');
}

function k8sRestarting() {
  contextMenuItems[0].label = 'Kubernetes is starting';
  contextMenuItems[0].icon = './resources/icons/kubernetes-icon-black.png';
  let contextMenu = Menu.buildFromTemplate(contextMenuItems);
  trayMenu.setContextMenu(contextMenu);
  trayMenu.setImage('./resources/icons/logo-square-bw.png');
}

exports.init = init;
exports.k8sStarted = k8sStarted;
exports.k8sStopping = k8sStopping;
exports.k8sRestarting = k8sRestarting;

function updateContexts() {
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();

  contextMenuItems[3].submenu = [];

  const curr = kc.getCurrentContext();

  const cxts = kc.getContexts();

  if (cxts.length === 0) {
    contextMenuItems[3].submenu.push({label: "None found"});
  } else {
    cxts.forEach((val) => {
      let n = {label: val.name, type: 'checkbox', click: contextClick};
      if (n.label == curr) {
        n.checked = true;
      }
      contextMenuItems[3].submenu.push(n);
    })
  }

}

function contextClick(menuItem) {
  kubectl.setCurrentContext(menuItem.label, () => {
    updateContexts();
    let contextMenu = Menu.buildFromTemplate(contextMenuItems);
    trayMenu.setContextMenu(contextMenu);
  })
}