// This import is for the tray found in the menu bar (upper right on macos or
// lower right on Windows).

import fs from 'fs';
import os from 'os';
import path from 'path';

import { KubeConfig } from '@kubernetes/client-node';
import Electron from 'electron';

import { VMBackend } from '@pkg/backend/backend';
import { State } from '@pkg/backend/k8s';
import * as kubeconfig from '@pkg/backend/kubeconfig';
import { Settings } from '@pkg/config/settings';
import { getIpcMainProxy } from '@pkg/main/ipcMain';
import mainEvents from '@pkg/main/mainEvents';
import { checkConnectivity } from '@pkg/main/networking';
import Logging from '@pkg/utils/logging';
import { networkStatus } from '@pkg/utils/networks';
import paths from '@pkg/utils/paths';
import { openMain, send } from '@pkg/window';
import { openDashboard } from '@pkg/window/dashboard';
import { openPreferences } from '@pkg/window/preferences';

const console = Logging.background;
const ipcMainProxy = getIpcMainProxy(console);

/**
 * Tray is a class to manage the tray icon for rancher-desktop.
 */
export class Tray {
  protected trayMenu:              Electron.Tray;
  protected backendIsLocked = '';
  protected kubernetesState = State.STOPPED;
  private settings:                Settings;
  private currentNetworkStatus:    networkStatus = networkStatus.CHECKING;
  private static instance:         Tray;
  private networkState:            boolean | undefined;
  private networkInterval:         NodeJS.Timeout;
  private runBuildFromConfigTimer: NodeJS.Timeout | null = null;
  private kubeConfigWatchers:      fs.FSWatcher[] = [];
  private fsWatcherInterval:       NodeJS.Timeout;

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
      label:   '?',
      type:    'normal',
      icon:    '',
    },
    { type: 'separator' },
    {
      id:    'main',
      label: 'Open main window',
      type:  'normal',
      click() {
        openMain();
      },
    },
    {
      id:    'preferences',
      label: 'Open preferences dialog',
      type:  'normal',
      click: openPreferences,
    },
    {
      id:      'dashboard',
      enabled: false,
      label:   'Open cluster dashboard',
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
      id:    'quit',
      label: 'Quit Rancher Desktop',
      role:  'quit',
      type:  'normal',
    },
  ];

  private isMacOs = () => {
    return os.platform() === 'darwin';
  };

  private isLinux = () => {
    return os.platform() === 'linux';
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
    for (const watcher of this.kubeConfigWatchers) {
      watcher.close();
    }
    this.kubeConfigWatchers = [];

    const paths = await kubeconfig.getKubeConfigPaths();
    const options: fs.WatchOptions = {
      persistent: false,
      recursive:  !this.isLinux(), // Recursive not implemented in Linux
      encoding:   'utf-8',
    };

    this.kubeConfigWatchers = paths.map(filepath => fs.watch(filepath, options, async(eventType) => {
      if (eventType === 'rename') {
        try {
          await fs.promises.access(filepath);
        } catch (ex) {
          // File doesn't exist; wait for it to be recreated.
          return;
        }
      }

      // This prevents calling buildFromConfig multiple times in quick succession
      // while making sure that the last file change within the period is processed.
      this.runBuildFromConfigTimer ||= setTimeout(() => {
        this.runBuildFromConfigTimer = null;
        this.buildFromConfig();
      }, 1_000);
    }));
  }

  private constructor(settings: Settings) {
    this.settings = settings;
    this.trayMenu = new Electron.Tray(this.trayIconSet.starting);
    this.trayMenu.setToolTip('Rancher Desktop');
    const menuItem = this.contextMenuItems.find(item => item.id === 'container-engine');

    if (menuItem) {
      menuItem.label = `Container engine: ${ this.settings.containerEngine.name }`;
    }

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

    // We reset the watchers on an interval in the event that `fs.watch` silently
    // fails to keep watching. This original issue is documented at
    // https://github.com/rancher-sandbox/rancher-desktop/pull/2038 and further discussed at
    // https://github.com/rancher-sandbox/rancher-desktop/pull/7238#discussion_r1690128729
    this.fsWatcherInterval = setInterval(() => this.watchForChanges(), 5 * 60_000);

    mainEvents.on('backend-locked-update', this.backendStateEvent);
    mainEvents.emit('backend-locked-check');
    mainEvents.on('k8s-check-state', this.k8sStateChangedEvent);
    mainEvents.on('settings-update', this.settingsUpdateEvent);

    // This triggers the CONNECTED_TO_INTERNET diagnostic at a set interval and
    // updates the network status in the tray if there's a change in the network
    // state.
    this.networkInterval = setInterval(async() => {
      let networkDiagnostic = await mainEvents.invoke('diagnostics-trigger', 'CONNECTED_TO_INTERNET');

      if (Array.isArray(networkDiagnostic)) {
        networkDiagnostic = networkDiagnostic.shift();
      }
      if (this.networkState === networkDiagnostic?.passed) {
        return; // network state hasn't changed since last check
      }

      this.networkState = !!networkDiagnostic?.passed;

      this.handleUpdateNetworkStatus(this.networkState).catch((err: any) => {
        console.log('Error updating network status: ', err);
      });
    }, 5000);
  }

  private backendStateEvent = (backendIsLocked: string) => {
    this.backendStateChanged(backendIsLocked);
  };

  private k8sStateChangedEvent = (mgr: VMBackend) => {
    this.k8sStateChanged(mgr.state);
  };

  private settingsUpdateEvent = (cfg: Settings) => {
    this.settings = cfg;
    this.settingsChanged();
  };

  private updateNetworkStatusEvent = (_: Electron.IpcMainEvent, status: boolean) => {
    this.handleUpdateNetworkStatus(status).catch((err:any) => {
      console.log('Error updating network status: ', err);
    });
  };

  /**
   * Checks for an existing instance of Tray. If one does not
   * exist, instantiate a new one.
   */
  public static getInstance(settings: Settings): Tray {
    Tray.instance ??= new Tray(settings);

    return Tray.instance;
  }

  /**
   * Hide the tray menu.
   */
  public hide() {
    this.trayMenu.destroy();
    mainEvents.off('k8s-check-state', this.k8sStateChangedEvent);
    mainEvents.off('settings-update', this.settingsUpdateEvent);
    ipcMainProxy.removeListener('update-network-status', this.updateNetworkStatusEvent);
    clearInterval(this.fsWatcherInterval);
    clearInterval(this.networkInterval);
    if (this.runBuildFromConfigTimer) {
      clearTimeout(this.runBuildFromConfigTimer);
      this.runBuildFromConfigTimer = null;
    }
    for (const watcher of this.kubeConfigWatchers) {
      watcher.close();
    }
    this.kubeConfigWatchers = [];
  }

  /**
   * Show the tray menu.
   */
  public show() {
    if (this.trayMenu.isDestroyed()) {
      Tray.instance = new Tray(this.settings);
    }
  }

  protected async handleUpdateNetworkStatus(status: boolean) {
    if (!status) {
      this.currentNetworkStatus = networkStatus.OFFLINE;
    } else {
      this.currentNetworkStatus = await checkConnectivity('k3s.io') ? networkStatus.CONNECTED : networkStatus.OFFLINE;
    }
    mainEvents.emit('update-network-status', this.currentNetworkStatus === networkStatus.CONNECTED);
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

  protected backendStateChanged(backendIsLocked: string) {
    this.backendIsLocked = backendIsLocked;
    this.updateMenu();
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
    if (this.trayMenu.isDestroyed()) {
      return;
    }

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

    this.contextMenuItems
      .filter(item => item.id && ['preferences', 'dashboard', 'contexts', 'quit'].includes(item.id))
      .forEach((item) => {
        item.enabled = !this.backendIsLocked;
      });

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
