import { Log } from '@pkg/utils/logging';
import Electron from 'electron';

import type { IpcMainEvents, IpcMainInvokeEvents } from '@pkg/typings/electron-ipc';

// Intended to be passed to the replacer parameter in a JSON.stringify
// call. Should rectify any circular references that the object you are
// stringifying may have.
function removeCircularReferences(property: string | symbol, value: any): any {
  if (property === '_idlePrev') {
    return undefined;
  }

  return value;
}

export function makeArgsPrintable(args: any[]): string[] {
  const maxPrintableArgLength = 500;
  const printableArgs = args.map((arg) => {
    let printableArg = JSON.stringify(arg, removeCircularReferences);

    if (printableArg.length > maxPrintableArgLength) {
      printableArg = printableArg.slice(0, maxPrintableArgLength);
      printableArg += '...';
    }

    return printableArg;
  });

  return printableArgs;
}

interface IpcMainProxy {
  on<eventName extends keyof IpcMainEvents>(
    channel: eventName,
    listener: (event: Electron.IpcMainEvent, ...args: globalThis.Parameters<IpcMainEvents[eventName]>) => void
  ): this;
  once<eventName extends keyof IpcMainEvents>(
    channel: eventName,
    listener: (event: Electron.IpcMainEvent, ...args: globalThis.Parameters<IpcMainEvents[eventName]>) => void
  ): this;
  removeListener<eventName extends keyof IpcMainEvents>(
    channel: eventName,
    listener: (event: Electron.IpcMainEvent, ...args: globalThis.Parameters<IpcMainEvents[eventName]>) => void
  ): this;
  removeAllListeners<eventName extends keyof IpcMainEvents>(channel?: eventName): this;

  handle<eventName extends keyof IpcMainInvokeEvents>(
    channel: eventName,
    listener: (
      event: Electron.IpcMainInvokeEvent,
      ...args: globalThis.Parameters<IpcMainInvokeEvents[eventName]>
    ) => Promise<ReturnType<IpcMainInvokeEvents[eventName]>> | ReturnType<IpcMainInvokeEvents[eventName]>
  ): void;
  handleOnce<eventName extends keyof IpcMainInvokeEvents>(
    channel: eventName,
    listener: (
      event: Electron.IpcMainInvokeEvent,
      ...args: globalThis.Parameters<IpcMainInvokeEvents[eventName]>
    ) => Promise<ReturnType<IpcMainInvokeEvents[eventName]>> | ReturnType<IpcMainInvokeEvents[eventName]>
  ): void;
  removeHandler<eventName extends keyof IpcMainInvokeEvents>(channel: eventName): void;
}

type Listener = (event: Electron.IpcMainEvent, ...args: any) => void;
type Handler = (event: Electron.IpcMainInvokeEvent, ...args: any) => Promise<unknown>;

class IpcMainProxyImpl implements IpcMainProxy {
  constructor(logger: Log) {
    this.logger = logger;
  }

  protected logger: Log;

  // Bijective weak maps between the user-provided listener and the wrapper that
  // introduces logging.  We do not keep strong references to either; the user-
  // provided listener is only kept alive by the wrapper, which the underlying
  // IpcMain has a strong reference to.
  protected listenerWrapperToRaw = new WeakMap<Listener, WeakRef<Listener>>();
  protected listenerRawToWrapper = new WeakMap<Listener, WeakRef<Listener>>();

  on(channel: string, listener: Listener): this {
    const wrapper: Listener = (event, ...args) => {
      const printableArgs = makeArgsPrintable(args);

      this.logger.debug(`ipcMain: "${ channel }" triggered with arguments: ${ printableArgs.join(', ') }`);
      listener(event, ...args);
    };

    this.listenerWrapperToRaw.set(wrapper, new WeakRef(listener));
    this.listenerRawToWrapper.set(listener, new WeakRef(wrapper));
    Electron.ipcMain.on(channel, wrapper);

    return this;
  }

  once(channel: string, listener: Listener): this {
    const wrapper: Listener = (event, ...args) => {
      const printableArgs = makeArgsPrintable(args);

      this.logger.debug(`ipcMain: "${ channel }" triggered with arguments: ${ printableArgs.join(', ') }`);
      listener(event, ...args);
    };

    this.listenerWrapperToRaw.set(wrapper, new WeakRef(listener));
    this.listenerRawToWrapper.set(listener, new WeakRef(wrapper));
    Electron.ipcMain.once(channel, wrapper);

    return this;
  }

  removeListener(channel: string, listener: Listener): this {
    const wrapper = this.listenerRawToWrapper.get(listener)?.deref();

    if (wrapper) {
      Electron.ipcMain.removeListener(channel, wrapper);
      this.listenerWrapperToRaw.delete(wrapper);
    }
    this.listenerRawToWrapper.delete(listener);

    return this;
  }

  removeAllListeners(channel?: string): this {
    Electron.ipcMain.removeAllListeners(channel);

    return this;
  }

  // For dealing with handlers, we don't need to keep track of the wrappers
  // (because removeHandler() doesn't actually take the handler to remove).

  handle(channel: string, handler: Handler): void {
    const wrapper: Handler = (event, ...args) => {
      const printableArgs = makeArgsPrintable(args);

      this.logger.debug(`ipcMain: "${ channel }" handle called with: ${ printableArgs.join(', ') }`);

      return handler(event, ...args);
    };

    Electron.ipcMain.handle(channel, wrapper);
  }

  handleOnce(channel: string, handler: Handler) {
    const wrapper: Handler = (event, ...args) => {
      const printableArgs = makeArgsPrintable(args);

      this.logger.debug(`ipcMain: "${ channel }" handle called with: ${ printableArgs.join(', ') }`);

      return handler(event, ...args);
    };

    Electron.ipcMain.handleOnce(channel, wrapper);
  }

  removeHandler(channel: string): void {
    Electron.ipcMain.removeHandler(channel);
  }
}

export function getIpcMainProxy(logger: Log): IpcMainProxy {
  return new IpcMainProxyImpl(logger);
}
