// This import is for the tray found in the menu bar (upper right on macos or
// lower right on Windows).

import fs from 'fs';
import os from 'os';
import path from 'path';

import { KubeConfig } from '@kubernetes/client-node';
import Electron from 'electron';

import { State } from '@pkg/backend/k8s';
import * as kubeconfig from '@pkg/backend/kubeconfig';
import { Settings, load } from '@pkg/config/settings';
import mainEvents from '@pkg/main/mainEvents';
import { checkConnectivity } from '@pkg/main/networking';
import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';
import { openMain, send } from '@pkg/window';
import { openDashboard } from '@pkg/window/dashboard';
import { openPreferences } from '@pkg/window/preferences';

const console = Logging.background;

enum networkStatus {
  CHECKING = 'checking...',
  CONNECTED = 'connected',
  OFFLINE = 'offline',
}

/**
 * Tray is a class to manage the tray icon for rancher-desktop.
 */
export class Tray {
  protected trayMenu: Electron.Tray;
  protected kubernetesState = State.STOPPED;
  private settings: Settings = load();
  private currentNetworkStatus: networkStatus = networkStatus.CHECKING;

  protected contextMenuItems: Electron.MenuItemConstructorOptions[] = [
    {
      id:      'state',
      enabled: false,
      label:   'Kubernetes is starting',
      type:    'normal',
      icon:    path.join(paths.resources, 'icons', 'kubernetes-icon-black.png'),
    },
    {
      id:      'network-status',
      enabled: false,
      label:   `Network status: ${ this.currentNetworkStatus }`,
      type:    'normal',
      icon:    '',
    },
    {
      id:      'container-engine',
      enabled: false,
      label:   `Container engine: ${ this.settings.containerEngine.name }`,
      type:    'normal',
      icon:    '',
    },
    { type: 'separator' },
    {
      id:    'main',
      label: 'Show main window',
      type:  'normal',
      click() {
        openMain();
      },
    },
    {
      id:    'preferences',
      label: 'Show preferences dialog',
      type:  'normal',
      click: openPreferences,
    },
    {
      id:      'dashboard',
      enabled: false,
      label:   'Show cluster dashboard',
      type:    'normal',
      click:   openDashboard,
    },
    { type: 'separator' },
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

  private isMacOs = () => {
    return os.platform() === 'darwin';
  };

  private readonly trayIconsMacOs = {
    stopped:  path.join(paths.resources, 'icons', 'logo-tray-stopped-Template@2x.png'),
    starting: path.join(paths.resources, 'icons', 'logo-tray-starting-Template@2x.png'),
    started:  path.join(paths.resources, 'icons', 'logo-tray-Template@2x.png'),
    stopping: path.join(paths.resources, 'icons', 'logo-tray-stopping-Template@2x.png'),
    error:    path.join(paths.resources, 'icons', 'logo-tray-error-Template@2x.png'),
  };

  private readonly trayIcons = {
    stopped:  '',
    starting: path.join(paths.resources, 'icons', 'logo-square-bw.png'),
    started:  path.join(paths.resources, 'icons', 'logo-square.png'),
    stopping: '',
    error:    path.join(paths.resources, 'icons', 'logo-square-red.png'),
  };

  private readonly trayIconSet = this.isMacOs() ? this.trayIconsMacOs : this.trayIcons;

  /**
   * Watch for changes to the kubeconfig files; when the change event is
   * triggered, close the watcher and restart after a duration (one second).
   */
  private async watchForChanges() {
    const abortController = new AbortController();
    const paths = await kubeconfig.getKubeConfigPaths();
    const options: fs.WatchOptions = {
      persistent: false,
      recursive:  true,
      encoding:   'utf-8',
      signal:     abortController.signal,
    };

    paths.map(filepath => fs.watch(filepath, options, async(eventType) => {
      if (eventType === 'rename') {
        try {
          await fs.promises.access(filepath);
        } catch (ex) {
          // File doesn't exist; wait for it to be recreated.
          return;
        }
      }

      abortController.abort();
      this.buildFromConfig();

      setTimeout(this.watchForChanges.bind(this), 1_000);
    }));
  }

  constructor() {
    this.trayMenu = new Electron.Tray(this.trayIconSet.starting);
    this.trayMenu.setToolTip('Rancher Desktop');

    // Discover k8s contexts
    try {
      this.updateContexts();
    } catch (err) {
      Electron.dialog.showErrorBox('Error starting the app:',
        `Error message: ${ err instanceof Error ? err.message : err }`);
    }

    const contextMenu = Electron.Menu.buildFromTemplate(this.contextMenuItems);

    this.trayMenu.setContextMenu(contextMenu);

    this.buildFromConfig();
    this.watchForChanges();

    mainEvents.on('k8s-check-state', (mgr) => {
      this.k8sStateChanged(mgr.state);
    });
    mainEvents.on('settings-update', (cfg) => {
      this.settings = cfg;
      this.settingsChanged();
    });

    /**
     * This event is called from the renderer, at startup with status based on the navigator object's onLine field,
     * and on window.online/offline events.
     * The main process actually checks connectivity to `k3s.io` to verify an online status.
     *
     * This system isn't perfect -- if the renderer window is closed when connection status changes, the info is lost.
     */
    Electron.ipcMain.on('update-network-status', (_, status: boolean) => {
      this.handleUpdateNetworkStatus(status).catch((err:any) => {
        console.log('Error updating network status: ', err);
      });
    });
  }

  protected async handleUpdateNetworkStatus(status: boolean) {
    if (!status) {
      this.currentNetworkStatus = networkStatus.OFFLINE;
    } else {
      this.currentNetworkStatus = await checkConnectivity('k3s.io') ? networkStatus.CONNECTED : networkStatus.OFFLINE;
    }
    send('update-network-status', this.currentNetworkStatus === networkStatus.CONNECTED);
    this.updateMenu();
  }

  protected buildFromConfig() {
    try {
      this.updateContexts();
      const contextMenu = Electron.Menu.buildFromTemplate(this.contextMenuItems);

      this.trayMenu.setContextMenu(contextMenu);
    } catch (err) {
      console.log(`Error trying to update context menu: ${ err }`);
    }
  }

  /**
   * Called when the Kubernetes cluster state has changed.
   * @param state The new cluster state.
   */
  protected k8sStateChanged(state: State) {
    this.kubernetesState = state;
    this.updateMenu();
  }

  /**
   * Called when the application settings have changed.
   */
  protected settingsChanged() {
    this.updateMenu();
  }

  protected updateMenu() {
    const labels = {
      [State.STOPPED]:  'Kubernetes is stopped',
      [State.STARTING]: 'Kubernetes is starting',
      [State.STARTED]:  'Kubernetes is running',
      [State.STOPPING]: 'Kubernetes is shutting down',
      [State.ERROR]:    'Kubernetes has encountered an error',
      [State.DISABLED]: 'Kubernetes is disabled',
    };

    let icon = path.join(paths.resources, 'icons', 'kubernetes-icon-black.png');
    let logo = this.trayIconSet.starting;

    if (this.kubernetesState === State.STARTED || this.kubernetesState === State.DISABLED) {
      icon = path.join(paths.resources, 'icons', 'kubernetes-icon-color.png');
      logo = this.trayIconSet.started;
      // Update the contexts as a new kubernetes context will be added
      this.updateContexts();
      this.contextMenuItems = this.updateDashboardState(
        this.kubernetesState === State.STARTED &&
        this.settings.kubernetes.enabled,
      );
    } else if (this.kubernetesState === State.ERROR) {
      // For licensing reasons, we cannot just tint the Kubernetes logo.
      // Here we're using an icon from GitHub's octicons set.
      icon = path.join(paths.resources, 'icons', 'issue-opened-16.png');
      logo = this.trayIconSet.error;
    }

    const stateMenu = this.contextMenuItems.find(item => item.id === 'state');

    if (stateMenu) {
      stateMenu.label = labels[this.kubernetesState] || labels[State.ERROR];
      stateMenu.icon = icon;
    }

    const containerEngineMenu = this.contextMenuItems.find(item => item.id === 'container-engine');

    if (containerEngineMenu) {
      const containerEngine = this.settings.containerEngine.name;

      containerEngineMenu.label = containerEngine === 'containerd' ? containerEngine : `dockerd (${ containerEngine })`;
      containerEngineMenu.icon = containerEngine === 'containerd' ? path.join(paths.resources, 'icons', 'containerd-icon-color.png') : '';
    }
    const networkStatusItem = this.contextMenuItems.find(item => item.id === 'network-status');

    if (networkStatusItem) {
      networkStatusItem.label = `Network status: ${ this.currentNetworkStatus }`;
    }
    const contextMenu = Electron.Menu.buildFromTemplate(this.contextMenuItems);

    this.trayMenu.setContextMenu(contextMenu);
    this.trayMenu.setImage(logo);
  }

  protected updateDashboardState = (enabled = true) => this.contextMenuItems
    .map(item => item.id === 'dashboard' ? { ...item, enabled } : item);

  /**
   * Update the list of Kubernetes contexts in the tray menu.
   * This does _not_ raise any exceptions if we fail to read the config.
   */
  protected updateContexts() {
    const kc = new KubeConfig();

    try {
      kc.loadFromDefault();
    } catch (ex) {
      console.error('Failed to load kubeconfig, ignoring:', ex);
      // Keep going, with no context set.
    }

    const contextsMenu = this.contextMenuItems.find(item => item.id === 'contexts');
    const curr = kc.getCurrentContext();
    const cxts = kc.getContexts();

    if (!contextsMenu) {
      return;
    }
    if (cxts.length === 0) {
      contextsMenu.submenu = [{ label: 'None found' }];
    } else {
      contextsMenu.submenu = cxts.map(val => ({
        label:   val.name,
        type:    'checkbox',
        click:   menuItem => this.contextClick(menuItem),
        checked: (val.name === curr),
      }));
    }
  }

  /**
   * Call back when a menu item is clicked to change the active Kubernetes context.
   * @param {Electron.MenuItem} menuItem The menu item that was clicked.
   */
  protected contextClick(menuItem: Electron.MenuItem) {
    kubeconfig.setCurrentContext(menuItem.label, () => {
      this.updateContexts();
      const contextMenu = Electron.Menu.buildFromTemplate(this.contextMenuItems);

      this.trayMenu.setContextMenu(contextMenu);
    });
  }
}

export default function setupTray() {
  new Tray();
}
