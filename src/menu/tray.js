'use strict';

// This import is for the tray found in the menu bar (upper right on macos or
// lower right on Windows).

const { app, Tray, Menu } = require('electron');
const kubectl = require('../k8s-engine/kubectl.js');
const kubeconfig = require('../config/kubeconfig.js');
const k8s = require('@kubernetes/client-node');
const { State } = require('../k8s-engine/k8s.js');
const fs = require('fs');
const resources = require('../resources');

let trayMenu = null

let contextMenuItems = [
  {
    id: 'state',
    label: 'Kubernetes is starting',
    type: 'normal',
    icon: resources.get('icons/kubernetes-icon-black.png'),
  },
  { type: 'separator' },
  {
    id: 'preferences',
    label: 'Preferences',
    type: 'normal',
    click: () => app.emit('window-preferences'),
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    type: 'normal',
    click: () => app.emit('window-dashboard'),
  },
  {
    id: 'contexts',
    label: 'Kubernetes Contexts',
    type: 'submenu',
    submenu: [],
  },
  { type: 'separator' },
  { label: 'Quit Rancher Desktop',
    role: 'quit',
    type: 'normal'
  }
]

function init() {
  trayMenu = new Tray(resources.get('icons/logo-square-bw.png'));

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

function k8sStateChanged(state) {
  const labels = {
    [State.STOPPED]: 'Kubernetes is stopped',
    [State.STARTING]: 'Kubernetes is starting',
    [State.STARTED]: 'Kubernetes is running',
    [State.READY]: 'Kubernetes is ready',
    [State.STOPPING]: 'Kubernetes is shutting down',
    [State.ERROR]: 'Kubernetes has encountered an error',
  }

  let icon = resources.get('icons/kubernetes-icon-black.png');
  let logo = resources.get('icons/logo-square-bw.png');

  if (state === State.STARTED || state === State.READY) {
    icon = resources.get('/icons/kubernetes-icon-color.png');
    logo = resources.get('/icons/logo-square.png');
    // Update the contexts as a new kubernetes context will be added
    updateContexts();
  } else if (state === State.ERROR) {
    // For licensing reasons, we cannot just tint the Kubernetes logo.
    // Here we're using an icon from GitHub's octicons set.
    icon = resources.get('/icons/issue-opened-16.png');
    logo = resources.get('/icons/logo-square-red.png');
  }

  let stateMenu = contextMenuItems.find((item) => item.id === 'state');
  stateMenu.label = labels[state] || labels[State.ERROR];
  stateMenu.icon = icon;

  contextMenuItems.find((item) => item.id === 'dashboard').enabled = (state === State.READY);

  let contextMenu = Menu.buildFromTemplate(contextMenuItems);
  trayMenu.setContextMenu(contextMenu);
  trayMenu.setImage(logo);
}

exports.init = init;
exports.k8sStateChanged = k8sStateChanged;

function updateContexts() {
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();

  let contextsMenu = contextMenuItems.find((item) => item.id === 'contexts');
  const curr = kc.getCurrentContext();

  const cxts = kc.getContexts();

  if (cxts.length === 0) {
    contextsMenu.submenu = [{ label: "None found" }];
  } else {
    contextsMenu.submenu = cxts.map((val) => ({
      label: val.name,
      type: 'checkbox',
      click: contextClick,
      checked: (val.name === curr),
    }));
  }

}

function contextClick(menuItem) {
  kubectl.setCurrentContext(menuItem.label, () => {
    updateContexts();
    let contextMenu = Menu.buildFromTemplate(contextMenuItems);
    trayMenu.setContextMenu(contextMenu);
  })
}