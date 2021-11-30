import { IpcRenderer } from 'electron';
import { IpcRequest } from '@/main/ipc/ipc-channel.interface';

export class Ipc {
  private ipcRenderer?: IpcRenderer;

  public send<T>(channel: string, request: IpcRequest = {}): Promise<T> {
    if (!this.ipcRenderer) {
      this.initializeIpcRenderer();
    }

    if (!request.responseChannel) {
      request.responseChannel = `${ channel }_response_${ new Date().getTime() }`;
    }

    const ipcRenderer = this.ipcRenderer;

    ipcRenderer?.send(channel, request);

    return new Promise((resolve) => {
      ipcRenderer?.once(
        request.responseChannel || '',
        (_event: any, response: any) => resolve(response)
      );
    });
  }

  private initializeIpcRenderer() {
    if (!window || !window.process || !window.require) {
      throw new Error('Unable to require renderer process');
    }

    this.ipcRenderer = window.require('electron').ipcRenderer;
  }
}
