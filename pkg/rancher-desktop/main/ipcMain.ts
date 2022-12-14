import Electron from 'electron';

import type { IpcMainEvents, IpcMainInvokeEvents } from '@pkg/typings/electron-ipc';
import { Log } from '@pkg/utils/logging';

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

export function getIpcMainProxy(logger: Log) {
  return new Proxy(Electron.ipcMain, {
    get: (target, property) => {
      if (property === 'on') {
        return (channel: string, listener: (event: Electron.IpcMainEvent, ...args: any[]) => void) => {
          const newListener = (event: Electron.IpcMainEvent, ...args: any[]) => {
            const printableArgs = makeArgsPrintable(args);

            logger.debug(`ipcMain: "${ channel }" triggered with arguments: ${ printableArgs.join(', ') }`);
            listener(event, ...args);
          };

          return target[property](channel, newListener);
        };
      } else if (property === 'handle') {
        return (channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any) => {
          const newListener = (event: Electron.IpcMainInvokeEvent, ...args: any[]): any => {
            const printableArgs = makeArgsPrintable(args);

            logger.debug(`ipcMain: "${ channel }" handle called with: ${ printableArgs.join(', ') }`);

            return listener(event, ...args);
          };

          target[property](channel, newListener);
        };
      }

      return Reflect.get(target, property);
    },
  }) as IpcMainProxy;
}
