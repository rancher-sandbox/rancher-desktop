import Electron from 'electron';

import type { IpcRendererEvents } from '@pkg/typings/electron-ipc';

/**
 * Returns a typed helper that sends renderer IPC events to a specific
 * WebContents, swallowing errors if the frame has been destroyed.
 */
export function makeSendToFrame(sender: Electron.WebContents, logger?: { debug: (...args: any[]) => void }) {
  return <ch extends keyof IpcRendererEvents>(channel: ch, ...args: Parameters<IpcRendererEvents[ch]>) => {
    try {
      sender.send(channel, ...args);
    } catch (ex) {
      logger?.debug(`Failed to send ${ channel } to frame:`, ex);
    }
  };
}
