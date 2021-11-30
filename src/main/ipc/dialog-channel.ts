import { IpcMainEvent, BrowserWindow, dialog } from 'electron';
import { MessageBoxOptions } from 'electron/main';
import { IpcChannel, IpcRequest } from './ipc-channel.interface';

interface IpcRequestDialog extends IpcRequest {
  options: MessageBoxOptions
}

export class DialogChannel implements IpcChannel {
  getName(): string {
    return 'dialog';
  }

  async handle(event: IpcMainEvent, request: IpcRequestDialog): Promise<void> {
    if (!request.responseChannel) {
      request.responseChannel = `ok:${ this.getName() }`;
    }

    const browserWindow = BrowserWindow.fromWebContents(event.sender);

    if (!browserWindow) {
      return;
    }

    const result = await dialog.showMessageBox(
      browserWindow,
      request.options
    );

    event.sender.send(
      request.responseChannel,
      { result }
    );
  }
}

export class DialogErrorChannel implements IpcChannel {
  getName(): string {
    return 'dialog-error';
  }

  handle(event: IpcMainEvent, request: IpcRequestDialog): void {
    dialog.showErrorBox('FAIL', 'THIS REALLY FAILED');

    event.sender.send(
      request.responseChannel || `ok:${ this.getName() }`
    );
  }
}
