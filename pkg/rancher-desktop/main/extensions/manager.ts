import fs from 'fs';
import os from 'os';
import path from 'path';

import Electron, { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import _ from 'lodash';

import { ExtensionImpl } from './extensions';

import type { ContainerEngineClient } from '@pkg/backend/containerClient';
import type { Settings } from '@pkg/config/settings';
import { getIpcMainProxy } from '@pkg/main/ipcMain';
import type { IpcMainEvents, IpcMainInvokeEvents, IpcRendererEvents } from '@pkg/typings/electron-ipc';
import * as childProcess from '@pkg/utils/childProcess';
import fetch, { RequestInit } from '@pkg/utils/fetch';
import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';
import type { RecursiveReadonly } from '@pkg/utils/typeUtils';

import type { Extension, ExtensionManager, SpawnOptions, SpawnResult } from './types';

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

  /**
   * Processes from extensions created in spawnStreaming() that may still be
   * running.
   */
  protected processes: Record<string, WeakRef<childProcess.ChildProcess>> = {};

  async init(config: RecursiveReadonly<Settings>) {
    // Handle events from the renderer process.
    this.setMainHandler('extensions/host-info', () => ({
      platform: process.platform,
      arch:     Electron.app.runningUnderARM64Translation ? 'arm64' : process.arch,
      hostname: os.hostname(),
    }));

    this.setMainListener('extensions/open-external', (...[, url]) => {
      Electron.shell.openExternal(url);
    });

    this.setMainListener('extensions/spawn/kill', (event, execId) => {
      const extensionId = this.getExtensionIdFromEvent(event);
      const fullExecId = `${ extensionId }:${ execId }`;
      const process = this.processes[fullExecId]?.deref();

      process?.kill();
    });

    this.setMainListener('extensions/spawn/streaming', async(event, options) => {
      switch (options.scope) {
      case 'host':
        return this.spawnStreaming(event, this.convertHostOptions(event, options));
      case 'docker-cli':
        return this.spawnStreaming(event, this.convertDockerCliOptions(event, options));
      case 'container':
        return this.spawnStreaming(event, await this.convertContainerOptions(event, options));
      }
      console.error(`Unexpected scope ${ options.scope }`);
      throw new Error(`Unexpected scope ${ options.scope }`);
    });

    this.setMainHandler('extensions/spawn/blocking', async(event, options) => {
      switch (options.scope) {
      case 'host':
        return this.spawnBlocking(this.convertHostOptions(event, options));
      case 'docker-cli':
        return this.spawnBlocking(this.convertDockerCliOptions(event, options));
      case 'container':
        return this.spawnBlocking(await this.convertContainerOptions(event, options));
      }
      console.error(`Unexpected scope ${ options.scope }`);
      throw new Error(`Unexpected scope ${ options.scope }`);
    });

    this.setMainHandler('extensions/ui/show-open', (event, options) => {
      const window = Electron.BrowserWindow.fromWebContents(event.sender);

      if (window) {
        return Electron.dialog.showOpenDialog(window, options);
      }

      return Electron.dialog.showOpenDialog(options);
    });

    this.setMainListener('extensions/ui/toast', (event, level, message) => {
      const title = {
        success: 'Success',
        warning: 'Warning',
        error:   'Error',
      }[level];
      const urgency = ({
        success: 'low',
        warning: 'normal',
        error:   'critical',
      } as const)[level];

      const notification = new Electron.Notification({
        title,
        body: message,
        urgency,
      });

      notification.show();
    });

    this.setMainHandler('extensions/vm/http-fetch', async(event, config) => {
      const extensionId = this.getExtensionIdFromEvent(event);
      const url = new URL(config.url);

      if (!url.hostname) {
        console.error(`Fetching from extension backend service not implemented yet (${ extensionId } fetching ${ url })`);

        return Promise.reject(new Error('Could not fetch from backend'));
      }

      const options: RequestInit = {
        method:  config.method,
        headers: config.headers ?? {},
        body:    config.data,
      };
      const response = await fetch(url.toString(), options);

      return await response.text();
    });

    // Install / uninstall extensions as needed.
    await Promise.all(Object.entries(config.extensions ?? {}).map(async([id, install]) => {
      const op = install ? 'install' : 'uninstall';

      try {
        await this.getExtension(id)[op]();
      } catch (ex) {
        console.error(`Failed to ${ op } extension "${ id }"`, ex);
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

  async getInstalledExtensions() {
    const extensions = Object.values(this.extensions);
    let installedExtensions: string[] = [];

    try {
      installedExtensions = await fs.promises.readdir(paths.extensionRoot);
    } catch (ex: any) {
      if ((ex as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return [];
      }
      throw ex;
    }

    const transformedExtensions = extensions
      .filter((extension) => {
        const encodedExtension = Buffer.from(extension.id).toString('base64url');

        return installedExtensions.includes(encodedExtension);
      })
      .map(async(current) => {
        const { id } = current;
        const metadata = await current.metadata;

        return {
          id,
          metadata,
        };
      });

    return await Promise.all(transformedExtensions);
  }

  /**
   * Given an IpcMainEvent, return the extension ID associated with it.
   */
  protected getExtensionIdFromEvent(event: IpcMainEvent | IpcMainInvokeEvent): string {
    const origin = new URL(event.senderFrame.origin);

    return Buffer.from(origin.hostname, 'hex').toString();
  }

  /**
   * Convert incoming spawn options from the host-exec context.
   */
  protected convertHostOptions(event: IpcMainEvent | IpcMainInvokeEvent, options: SpawnOptions): SpawnOptions {
    const extensionId = this.getExtensionIdFromEvent(event);
    const extension = this.getExtension(extensionId) as ExtensionImpl;
    const exePath = path.join(extension.dir, 'bin', options.command[0]);

    return {
      ...options,
      command: [exePath, ...options.command.slice(1)],
    };
  }

  /**
   * Convert incoming spawn options from the docker-exec context.
   */
  protected convertDockerCliOptions(event: IpcMainEvent | IpcMainInvokeEvent, options: SpawnOptions): SpawnOptions {
    return {
      ...options,
      command: [this.client.executable, ...options.command],
    };
  }

  /**
   * Convert incoming spawn options from the container-exec context.
   */
  protected convertContainerOptions(event: IpcMainEvent | IpcMainInvokeEvent, options: SpawnOptions): Promise<SpawnOptions> {
    return Promise.reject(new Error('not implemented'));
  }

  /**
   * Spawn a process on behalf of an extension, returning a promise that will be
   * resolved when the process completes.
   */
  protected spawnBlocking(options: SpawnOptions): Promise<SpawnResult> {
    const args = options.command.concat();
    const exePath = args.shift();

    if (!exePath) {
      throw new Error(`no executable given`);
    }

    return new Promise((resolve) => {
      childProcess.execFile(exePath, args, { ..._.pick(options, ['cwd', 'env']) }, (error, stdout, stderr) => {
        resolve({
          cmd:    options.command.join(' '),
          result: error?.signal ?? error?.code ?? 0,
          stdout,
          stderr,
        });
      });
    });
  }

  /***
   * Helper for event.senderFrame.send() to add checking of channel names.
   */
  protected sendToFrame<K extends keyof IpcRendererEvents>(event: IpcMainEvent, channel: K, ...args: Parameters<IpcRendererEvents[K]>) {
    event.senderFrame.send(channel, ...args as any);
  }

  /**
   * Spawn a process on behalf of an extension, with the output fed back to the
   * extension via callbacks.
   */
  protected spawnStreaming(event: IpcMainEvent, options: SpawnOptions) {
    const extensionId = this.getExtensionIdFromEvent(event);
    const args = options.command.concat();
    const exePath = args.shift();

    if (!exePath) {
      throw new Error(`no executable given`);
    }

    const proc = childProcess.spawn(exePath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ..._.pick(options, ['cwd', 'env']),
    });
    let errored = false;

    proc.stdout.on('data', (stdout: string | Buffer) => {
      this.sendToFrame(event, 'extensions/spawn/output', options.execId, { stdout: stdout.toString('utf-8') });
    });
    proc.stderr.on('data', (stderr: string | Buffer) => {
      this.sendToFrame(event, 'extensions/spawn/output', options.execId, { stderr: stderr.toString('utf-8') });
    });
    proc.on('error', (error) => {
      errored = true;
      this.sendToFrame(event, 'extensions/spawn/error', options.execId, error);
    });
    proc.on('exit', (code, signal) => {
      if (errored) {
        return;
      }
      if (code !== null ) {
        this.sendToFrame(event, 'extensions/spawn/close', options.execId, code);
      } else if (signal !== null) {
        errored = true;
        this.sendToFrame(event, 'extensions/spawn/error', options.execId, signal);
      } else {
        errored = true;
        this.sendToFrame(event, 'extensions/spawn/error', options.execId, new Error('exited with neither code nor signal'));
      }
    });

    const fullId = `${ extensionId }:${ options.execId }`;

    this.processes[fullId] = new WeakRef(proc);
  }

  async shutdown() {
    // Remove our event listeners (to avoid issues when we switch backends).
    for (const untypedChannel in this.eventListeners) {
      const channel = untypedChannel as keyof IpcMainEvents;
      const listener = this.eventListeners[channel] as IpcMainEventListener<typeof channel>;

      ipcMain.removeListener(channel, listener);
    }

    for (const untypedChannel in this.eventHandlers) {
      ipcMain.removeHandler(untypedChannel as keyof IpcMainInvokeEvents);
    }

    await Promise.allSettled(Object.values(this.processes).map((proc) => {
      proc.deref()?.kill();
    }));
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
    throw new Error(`getExtensionManager called without configuration`);
  }

  await manager?.shutdown();

  console.debug(`Creating new extension manager...`);
  manager = new ExtensionManagerImpl(client);

  await manager.init(cfg);

  return manager;
}

export default getExtensionManager;
