'use strict';

// This import is for the tray found in the menu bar (upper right on macos or
// lower right on Windows).

const { EventEmitter } = require('events');
const fs = require('fs');
const electron = require('electron');
const k8s = require('@kubernetes/client-node');
const kubectl = require('../k8s-engine/kubectl.js');
const kubeconfig = require('../config/kubeconfig.js');
const { State } = require('../k8s-engine/k8s.js');
const resources = require('../resources');
const { State: HomesteadState } = require('../k8s-engine/homestead');

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
      id:    'state',
      label: 'Kubernetes is starting',
      type:  'normal',
      icon:  resources.get('icons/kubernetes-icon-black.png'),
    },
    { type: 'separator' },
    {
      id:    'preferences',
      label: 'Preferences',
      type:  'normal',
      click: () => this.emit('window-preferences'),
    },
    {
      id:    'dashboard',
      label: 'Dashboard',
      type:  'normal',
      click: () => this.emit('window-dashboard'),
    },
    {
      id:      'contexts',
      label:   'Kubernetes Contexts',
      type:    'submenu',
      submenu: [],
    },
    { type: 'separator' },
    { label: 'Quit Rancher Desktop',
      role:  'quit',
      type:  'normal',
    },
  ];
  #kubernetesState = State.STOPPED;
  #dashboardEnabled = false;

  constructor() {
    super();

    this.#contextClick = this.contextClick.bind(this);
    this.#trayMenu = new electron.Tray(resources.get('icons/logo-square-bw.png'));
    this.#trayMenu.setToolTip('Rancher Desktop');

    // Discover k8s contexts
    this.updateContexts();

    const contextMenu = electron.Menu.buildFromTemplate(this.#contextMenuItems);
    this.#trayMenu.setContextMenu(contextMenu);

    fs.watch(kubeconfig.path(), () => {
      this.updateContexts();
      const contextMenu = electron.Menu.buildFromTemplate(this.#contextMenuItems);
      this.#trayMenu.setContextMenu(contextMenu);
    });

    this.on('k8s-check-state', this.k8sStateChanged.bind(this));
    this.on('settings-update', this.settingsChanged.bind(this));
  }

  /**
   * Called when the Kubernetes cluster state has changed.
   * @param {State} state The new cluster state.
   */
  k8sStateChanged(state) {
    this.#kubernetesState = state;
    this.updateMenu();
  }

  /**
   * Called when the application settings have changed.
   * @param {import("../config/settings").Settings} settings The new settings.
   */
  settingsChanged(settings) {
    const mode = settings.kubernetes.rancherMode;
    this.#dashboardEnabled = (mode !== HomesteadState.NONE);
    this.updateMenu();
  }

  updateMenu() {
    const labels = {
      [State.STOPPED]:  'Kubernetes is stopped',
      [State.STARTING]: 'Kubernetes is starting',
      [State.STARTED]:  'Kubernetes is running',
      [State.READY]:    'Kubernetes is ready',
      [State.STOPPING]: 'Kubernetes is shutting down',
      [State.ERROR]:    'Kubernetes has encountered an error',
    };

    let icon = resources.get('icons/kubernetes-icon-black.png');
    let logo = resources.get('icons/logo-square-bw.png');

    if (this.#kubernetesState === State.STARTED || this.#kubernetesState === State.READY) {
      icon = resources.get('/icons/kubernetes-icon-color.png');
      logo = resources.get('/icons/logo-square.png');
      // Update the contexts as a new kubernetes context will be added
      this.updateContexts();
    } else if (this.#kubernetesState === State.ERROR) {
      // For licensing reasons, we cannot just tint the Kubernetes logo.
      // Here we're using an icon from GitHub's octicons set.
      icon = resources.get('/icons/issue-opened-16.png');
      logo = resources.get('/icons/logo-square-red.png');
    }

    const stateMenu = this.#contextMenuItems.find(item => item.id === 'state');
    stateMenu.label = labels[this.#kubernetesState] || labels[State.ERROR];
    stateMenu.icon = icon;

    const dashboardMenu = this.#contextMenuItems.find(item => item.id === 'dashboard');
    dashboardMenu.visible = this.#dashboardEnabled;
    dashboardMenu.enabled = (this.#kubernetesState === State.READY);

    const contextMenu = electron.Menu.buildFromTemplate(this.#contextMenuItems);
    this.#trayMenu.setContextMenu(contextMenu);
    this.#trayMenu.setImage(logo);
  }

  /**
   * Update the list of Kubernetes contexts in the tray menu.
   */
  updateContexts() {
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();

    const contextsMenu = this.#contextMenuItems.find(item => item.id === 'contexts');
    const curr = kc.getCurrentContext();

    const cxts = kc.getContexts();

    if (cxts.length === 0) {
      contextsMenu.submenu = [{ label: 'None found' }];
    } else {
      contextsMenu.submenu = cxts.map(val => ({
        label:   val.name,
        type:    'checkbox',
        click:   this.#contextClick,
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
      const contextMenu = electron.Menu.buildFromTemplate(this.#contextMenuItems);
      this.#trayMenu.setContextMenu(contextMenu);
    });
  }
}
