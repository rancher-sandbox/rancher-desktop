import { IpcMainEvent, IpcMainInvokeEvent } from 'electron';

import { ExtensionImpl } from './extensions';

import type { ContainerEngineClient } from '@pkg/backend/containerClient';
import type { Settings } from '@pkg/config/settings';
import { getIpcMainProxy } from '@pkg/main/ipcMain';
import type { IpcMainEvents, IpcMainInvokeEvents } from '@pkg/typings/electron-ipc';
import Logging from '@pkg/utils/logging';
import type { RecursiveReadonly } from '@pkg/utils/typeUtils';

import type { Extension, ExtensionManager } from './types';

const console = Logging.extensions;
const ipcMain = getIpcMainProxy(console);
let manager: ExtensionManager | undefined;

type IpcMainEventListener<K extends keyof IpcMainEvents> =
  (event: IpcMainEvent, ...args: Parameters<IpcMainEvents[K]>) => void;

type IpcMainEventHandler<K extends keyof IpcMainInvokeEvents> =
  (event: IpcMainInvokeEvent, ...args: Parameters<IpcMainInvokeEvents[K]>) =>
    Promise<ReturnType<IpcMainInvokeEvents[K]>> | ReturnType<IpcMainInvokeEvents[K]>;

class ExtensionManagerImpl implements ExtensionManager {
  protected extensions: Record<string, ExtensionImpl> = {};

  constructor(client: ContainerEngineClient) {
    this.client = client;
  }

  client: ContainerEngineClient;

  /**
   * Mapping of event listeners we used with ipcMain.on(), which will be used to
   * ensure we unregister them correctly.
   */
  protected eventListeners: {
    [channel in keyof IpcMainEvents]?: IpcMainEventListener<channel>;
  } = {};

  /**
   * Mapping of event handlers we used with ipcMain.handle(), which will be used
   * to ensure we unregister them correctly.
   */
  protected eventHandlers: {
    [channel in keyof IpcMainInvokeEvents]?: IpcMainEventHandler<channel>;
  } = {};

  /**
   * Attach a listener to ipcMainEvents that will be torn down when this
   * extension manager shuts down.
   * @note Only one listener per topic is supported.
   */
  protected setMainListener<K extends keyof IpcMainEvents>(channel: K, listener: IpcMainEventListener<K>) {
    const oldListener = this.eventListeners[channel] as IpcMainEventListener<K> | undefined;

    if (oldListener) {
      console.error(`Removing duplicate event listener for ${ channel }`);
      ipcMain.removeListener(channel, oldListener);
    }
    this.eventListeners[channel] = listener as any;
    ipcMain.on(channel, listener);
  }

  /**
   * Attach a handler to ipcMainInvokeEvents that will be torn down when this
   * extension manager shuts down.
   * @note Only one handler per topic is supported.
   */
  protected setMainHandler<K extends keyof IpcMainInvokeEvents>(channel: K, handler: IpcMainEventHandler<K>) {
    const oldHandler = this.eventHandlers[channel];

    if (oldHandler) {
      console.error(`Removing duplicate event handler for ${ channel }`);
      ipcMain.removeHandler(channel);
    }
    this.eventHandlers[channel] = handler as any;
    ipcMain.handle(channel, handler);
  }

  async init(config: RecursiveReadonly<Settings>) {
    // TODO: Handlers for various events from the renderer process.
    await Promise.all(Object.entries(config.extensions ?? {}).map(([id, install]) => {
      const op = install ? 'install' : 'uninstall';

      try {
        this.getExtension(id)[op]();
      } catch (ex) {
        console.error(`Failed to ${ op } extension ${ id }`, ex);
      }
    }));
  }

  getExtension(id: string): Extension {
    let ext = this.extensions[id];

    if (!ext) {
      ext = new ExtensionImpl(id, this.client);
      this.extensions[id] = ext;
    }

    return ext;
  }

  shutdown() {
    // Remove our event listeners (to avoid issues when we switch backends).
    for (const untypedChannel in this.eventListeners) {
      const channel = untypedChannel as keyof IpcMainEvents;
      const listener = this.eventListeners[channel] as IpcMainEventListener<typeof channel>;

      ipcMain.removeListener(channel, listener);
    }

    for (const untypedChannel in this.eventHandlers) {
      ipcMain.removeHandler(untypedChannel as keyof IpcMainInvokeEvents);
    }

    return Promise.resolve();
  }
}

async function getExtensionManager(): Promise<ExtensionManager | undefined>;
async function getExtensionManager(client: ContainerEngineClient, cfg: RecursiveReadonly<Settings>): Promise<ExtensionManager>;
async function getExtensionManager(client?: ContainerEngineClient, cfg?: RecursiveReadonly<Settings>): Promise<ExtensionManager | undefined> {
  if (!client || manager?.client === client) {
    if (!client && !manager) {
      console.debug(`Warning: cached client missing, returning nothing`);
    }

    return manager;
  }

  if (!cfg) {
    throw new Error(`getExtensionaManager called without configuration`);
  }

  await manager?.shutdown();

  console.debug(`Creating new extension manager...`);
  manager = new ExtensionManagerImpl(client);

  await manager.init(cfg);

  return manager;
}

export default getExtensionManager;
