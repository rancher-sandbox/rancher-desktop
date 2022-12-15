/**
 * This is a typed version of Electron.ipcRenderer
 */

import { ipcRenderer as ipcRendererImpl } from 'electron';

import { IpcMainEvents, IpcMainInvokeEvents, IpcRendererEvents } from '@pkg/typings/electron-ipc';

interface IpcRenderer {
  on<eventName extends keyof IpcRendererEvents>(
    channel: eventName,
    listener: (event: Electron.IpcRendererEvent, ...args: globalThis.Parameters<IpcRendererEvents[eventName]>) => void
  ): this;

  once<eventName extends keyof IpcRendererEvents>(
    channel: eventName,
    listener: (event: Electron.IpcRendererEvent, ...args: globalThis.Parameters<IpcRendererEvents[eventName]>) => void
  ): this;

  removeListener<eventName extends keyof IpcRendererEvents>(
    channel: eventName,
    listener: (event: Electron.IpcRendererEvent, ...args: globalThis.Parameters<IpcRendererEvents[eventName]>) => void
  ): this;

  removeAllListeners<eventName extends keyof IpcRendererEvents>(channel?: eventName): this;

  send<eventName extends keyof IpcMainEvents>(channel: eventName, ...args: Parameters<IpcMainEvents[eventName]>): void;
  sendSync<eventName extends keyof IpcMainEvents>(channel: eventName, ...args: Parameters<IpcMainEvents[eventName]>): void;

  // When the renderer side is implement in JavaScript (rather than TypeScript),
  // the type checking for arguments seems to fail and always prefers the
  // generic overload (which we want to avoid) rather than the specific overload
  // we provide here.  Until we convert all of the Vue components to TypeScript,
  // for now we will need to forego checking the arguments.
  invoke<eventName extends keyof IpcMainInvokeEvents>(
    channel: eventName,
    ...args: Parameters<IpcMainInvokeEvents[eventName]>
  ): Promise<ReturnType<IpcMainInvokeEvents[eventName]>>;
}

export const ipcRenderer: IpcRenderer = ipcRendererImpl as unknown as IpcRenderer;

export default ipcRenderer;
