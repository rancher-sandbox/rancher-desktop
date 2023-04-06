import { ChildProcessByStdio, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';

import { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import _ from 'lodash';

import { ExtensionImpl } from './extensions';

import type { ContainerEngineClient } from '@pkg/backend/containerClient';
import type { Settings } from '@pkg/config/settings';
import { getIpcMainProxy } from '@pkg/main/ipcMain';
import type { IpcMainEvents, IpcMainInvokeEvents, IpcRendererEvents } from '@pkg/typings/electron-ipc';
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

type ReadableChildProcess = ChildProcessByStdio<null, Readable, Readable>;

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
  protected processes: Record<string, WeakRef<ReadableChildProcess>> = {};

  async init(config: RecursiveReadonly<Settings>) {
    // Handle events from the renderer process.
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
        return this.execStreaming(event, options, this.spawnHost(event, options));
      case 'docker-cli':
        return this.execStreaming(event, options, this.spawnDockerCli(event, options));
      case 'container':
        return this.execStreaming(event, options, await this.spawnContainer(event, options));
      }
      console.error(`Unexpected scope ${ options.scope }`);
      throw new Error(`Unexpected scope ${ options.scope }`);
    });

    this.setMainHandler('extensions/spawn/blocking', async(event, options) => {
      switch (options.scope) {
      case 'host':
        return this.execBlocking(this.spawnHost(event, options));
      case 'docker-cli':
        return this.execBlocking(this.spawnDockerCli(event, options));
      case 'container':
        return this.execBlocking(await this.spawnContainer(event, options));
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

  /** Spawn a process in the host context. */
  protected spawnHost(event: IpcMainEvent | IpcMainInvokeEvent, options: SpawnOptions): ReadableChildProcess {
    const extensionId = this.getExtensionIdFromEvent(event);
    const extension = this.getExtension(extensionId) as ExtensionImpl;

    if (!extension) {
      throw new Error(`Could not find calling extension ${ extensionId }`);
    }

    return spawn(
      path.join(extension.dir, 'bin', options.command[0]),
      options.command.slice(1),
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        ..._.pick(options, ['cwd', 'env']),
      });
  }

  /** Spawn a process in the docker-cli context. */
  protected spawnDockerCli(event: IpcMainEvent | IpcMainInvokeEvent, options: SpawnOptions): ReadableChildProcess {
    const extensionId = this.getExtensionIdFromEvent(event);
    const extension = this.getExtension(extensionId) as ExtensionImpl;

    if (!extension) {
      throw new Error(`Could not find calling extension ${ extensionId }`);
    }

    return spawn(this.client.executable, options.command, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ..._.pick(options, ['cwd', 'env']),
    });
  }

  /** Spawn a process in the container context. */
  protected spawnContainer(event: IpcMainEvent | IpcMainInvokeEvent, options: SpawnOptions): Promise<ReadableChildProcess> {
    return Promise.reject(new Error('not implemented'));
  }

  /**
   * Execute a process on behalf of an extension, returning a promise that will
   * be resolved when the process completes.
   */
  protected execBlocking(process: ReadableChildProcess): Promise<SpawnResult> {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let errored = false;

    process.stdout.on('data', (data: string | Buffer) => {
      stdout.push(Buffer.from(data));
    });
    process.stderr.on('data', (data: string | Buffer) => {
      stderr.push(Buffer.from(data));
    });

    return new Promise((resolve, reject) => {
      process.on('error', (error) => {
        errored = true;
        reject(error);
      });

      process.on('exit', (code, signal) => {
        if (errored) {
          return;
        }
        resolve({
          cmd:    `${ process.spawnfile } ${ process.spawnargs.join(' ') }`,
          result: signal ?? code ?? 0,
          stdout: Buffer.concat(stdout).toString('utf-8'),
          stderr: Buffer.concat(stderr).toString('utf-8'),
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
   * Execute a process on behalf of an extension, with the output fed back to
   * the extension via callbacks.
   */
  protected execStreaming(event: IpcMainEvent, options: SpawnOptions, process: ReadableChildProcess) {
    const extensionId = this.getExtensionIdFromEvent(event);

    let errored = false;

    process.stdout.on('data', (stdout: string | Buffer) => {
      this.sendToFrame(event, 'extensions/spawn/output', options.execId, { stdout: stdout.toString('utf-8') });
    });
    process.stderr.on('data', (stderr: string | Buffer) => {
      this.sendToFrame(event, 'extensions/spawn/output', options.execId, { stderr: stderr.toString('utf-8') });
    });
    process.on('error', (error) => {
      errored = true;
      this.sendToFrame(event, 'extensions/spawn/error', options.execId, error);
    });
    process.on('exit', (code, signal) => {
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

    this.processes[fullId] = new WeakRef(process);
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
