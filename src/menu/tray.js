'use strict';

// This import is for the tray found in the menu bar (upper right on macos or
// lower right on Windows).

const { EventEmitter } = require('events');
const fs = require('fs');
const pth = require('path');
const electron = require('electron');
const yaml = require('yaml');
const k8s = require('@kubernetes/client-node');
const kubectl = require('../k8s-engine/kubectl.js');
const kubeconfig = require('../config/kubeconfig.js');
const { State } = require('../k8s-engine/k8s');
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
      id:      'contexts',
      label:   'Kubernetes Contexts',
      type:    'submenu',
      submenu: [],
    },
    { type: 'separator' },
    {
      label: 'Quit Rancher Desktop',
      role:  'quit',
      type:  'normal',
    },
  ];

  #kubernetesState = State.STOPPED;

  constructor() {
    super();

    this.#contextClick = this.contextClick.bind(this);
    this.#trayMenu = new electron.Tray(resources.get('icons/logo-square-bw.png'));
    this.#trayMenu.setToolTip('Rancher Desktop');

    // Discover k8s contexts
    try {
      this.updateContexts();
    } catch (err) {
      if (err instanceof TypeError &&
          err.message.includes("Cannot read property 'clusters' of undefined") &&
          err.stack?.includes('loadFromFile')) {
        electron.dialog.showErrorBox('Error reading config file:',
          'Please check your config file(s) for problems.');
      } else {
        electron.dialog.showErrorBox('Error starting the app:',
          `Error message: ${ err.message }`);
      }
    }

    const contextMenu = electron.Menu.buildFromTemplate(this.#contextMenuItems);

    this.#trayMenu.setContextMenu(contextMenu);

    const kubeconfigPath = kubeconfig.path();

    if (!kubeconfigPath) {
      throw new Error('No kubeconfig path found');
    }
    this.buildFromConfig(kubeconfigPath);
    const watcher = fs.watch(kubeconfigPath);

    watcher.on('error', (code, signal) => {
      console.log(`Failed to fs.watch ${ kubeconfigPath }: code: ${ code }, signal: ${ signal }`);
    });
    watcher.on('change', (eventType, _) => {
      if (eventType === 'rename' && !kubeconfig.hasAccess(kubeconfigPath)) {
        // File doesn't exist. Wait for it to be recreated
        return;
      }
      this.buildFromConfig(kubeconfigPath);
    });

    this.on('k8s-check-state', this.k8sStateChanged.bind(this));
    this.on('settings-update', this.settingsChanged.bind(this));
  }

  buildFromConfig(configPath) {
    if (!kubeconfig.hasAccess(configPath)) {
      return;
    }

    try {
      let parsedConfig;
      const contents = fs.readFileSync(configPath).toString();

      if (contents.length === 0) {
        console.log('Config file is empty, will try to process it later');

        return;
      }

      try {
        parsedConfig = yaml.parse(contents);
      } catch (err) {
        console.log(`yaml parse failure: ${ err } on kubeconfig: contents ${ contents }., will retry later.`);
        parsedConfig = null;
      }

      if ((parsedConfig?.clusters || []).length === 0) {
        console.log('Config file has no clusters, will retry later');

        return;
      }
      this.updateContexts();
      const contextMenu = electron.Menu.buildFromTemplate(this.#contextMenuItems);

      this.#trayMenu.setContextMenu(contextMenu);
    } catch (err) {
      console.log(`Error trying to update context menu: ${ err }`);
    }
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
    this.updateMenu();
  }

  updateMenu() {
    const labels = {
      [State.STOPPED]:  'Kubernetes is stopped',
      [State.STARTING]: 'Kubernetes is starting',
      [State.STARTED]:  'Kubernetes is running',
      [State.STOPPING]: 'Kubernetes is shutting down',
      [State.ERROR]:    'Kubernetes has encountered an error',
    };

    let icon = resources.get('icons/kubernetes-icon-black.png');
    let logo = resources.get('icons/logo-square-bw.png');

    if (this.#kubernetesState === State.STARTED) {
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

    const contextMenu = electron.Menu.buildFromTemplate(this.#contextMenuItems);

    this.#trayMenu.setContextMenu(contextMenu);
    this.#trayMenu.setImage(logo);
  }

  #verifyKubeConfig() {
    if (process.env.KUBECONFIG && process.env.KUBECONFIG.length > 0) {
      const originalFiles = process.env.KUBECONFIG.split(pth.delimiter);
      const filteredFiles = originalFiles.filter(kubeconfig.hasAccess);

      if (filteredFiles.length < originalFiles.length) {
        process.env.KUBECONFIG = filteredFiles.join(pth.delimiter);
      }
    }
  }

  /**
   * Update the list of Kubernetes contexts in the tray menu.
   */
  updateContexts() {
    const kc = new k8s.KubeConfig();

    this.#verifyKubeConfig();
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
