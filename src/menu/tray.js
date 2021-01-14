'use strict';

// This import is for the tray found in the menu bar (upper right on macos or
// lower right on Windows).

const electron = require('electron');
const { EventEmitter } = require('events');
const kubectl = require('../k8s-engine/kubectl.js');
const kubeconfig = require('../config/kubeconfig.js');
const k8s = require('@kubernetes/client-node');
const { State } = require('../k8s-engine/k8s.js');
const fs = require('fs');
const resources = require('../resources');

/**
 * Tray is a class to manage the tray icon for rancher-desktop.
 */
export class Tray extends EventEmitter {
  /** @type {electron.Tray} */
  #trayMenu = null;
  /** @type {(menuItem: electron.MenuItem) => void} */
  #contextClick = null;
  /** @type {electron.MenuItemConstructorOptions[]} */
  #contextMenuItems = [
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
      click: () => this.emit('window-preferences'),
    },
    {
      id: 'dashboard',
      label: 'Dashboard',
      type: 'normal',
      click: () => this.emit('window-dashboard'),
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
  ];

  constructor() {
    super();

    this.#contextClick = this.contextClick.bind(this);
    this.#trayMenu = new electron.Tray(resources.get('icons/logo-square-bw.png'));
    this.#trayMenu.setToolTip('Rancher Desktop');

    // Discover k8s contexts
    this.updateContexts();

    let contextMenu = electron.Menu.buildFromTemplate(this.#contextMenuItems);
    this.#trayMenu.setContextMenu(contextMenu);

    fs.watch(kubeconfig.path(), () => {
      this.updateContexts();
      let contextMenu = electron.Menu.buildFromTemplate(this.#contextMenuItems);
      this.#trayMenu.setContextMenu(contextMenu);
    });

    this.on('k8s-check-state', this.k8sStateChanged.bind(this));
  }

  /**
   * Called when the Kubernetes cluster state has changed.
   * @param {State} state The new cluster state.
   */
  k8sStateChanged(state) {
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
      this.updateContexts();
    } else if (state === State.ERROR) {
      // For licensing reasons, we cannot just tint the Kubernetes logo.
      // Here we're using an icon from GitHub's octicons set.
      icon = resources.get('/icons/issue-opened-16.png');
      logo = resources.get('/icons/logo-square-red.png');
    }

    let stateMenu = this.#contextMenuItems.find((item) => item.id === 'state');
    stateMenu.label = labels[state] || labels[State.ERROR];
    stateMenu.icon = icon;

    this.#contextMenuItems.find((item) => item.id === 'dashboard').enabled = (state === State.READY);

    let contextMenu = electron.Menu.buildFromTemplate(this.#contextMenuItems);
    this.#trayMenu.setContextMenu(contextMenu);
    this.#trayMenu.setImage(logo);
  }

  /**
   * Update the list of Kubernetes contexts in the tray menu.
   */
  updateContexts() {
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();

    let contextsMenu = this.#contextMenuItems.find((item) => item.id === 'contexts');
    const curr = kc.getCurrentContext();

    const cxts = kc.getContexts();

    if (cxts.length === 0) {
      contextsMenu.submenu = [{ label: "None found" }];
    } else {
      contextsMenu.submenu = cxts.map((val) => ({
        label: val.name,
        type: 'checkbox',
        click: this.#contextClick,
        checked: (val.name === curr),
      }));
    }

  }

  /**
   * Call back when a menu item is clicked to change the active Kubernetes context.
   * @param {electron.MenuItem} menuItem The menu item that was clicked.
   */
  contextClick(menuItem) {
    kubectl.setCurrentContext(menuItem.label, () => {
      this.updateContexts();
      let contextMenu = electron.Menu.buildFromTemplate(this.#contextMenuItems);
      this.#trayMenu.setContextMenu(contextMenu);
    });
  }
}
