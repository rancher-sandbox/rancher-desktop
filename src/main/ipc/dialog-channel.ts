import { IpcMainEvent, BrowserWindow, dialog } from 'electron';
import { IpcChannel, IpcRequest } from './ipc-channel.interface';

export class DialogChannel implements IpcChannel {
  getName(): string {
    return 'dialog';
  }

  async handle(event: IpcMainEvent, request: IpcRequest): Promise<void> {
    if (!request.responseChannel) {
      request.responseChannel = `${ this.getName() }_response`;
    }

    const browserWindow = BrowserWindow.fromWebContents(event.sender);

    if (!browserWindow) {
      return;
    }

    const result = await dialog.showMessageBox(
      browserWindow,
      {
        title:   'Message Box',
        message: 'Please select an option',
        detail:  'Message details',
        buttons: ['Yes', 'No', 'Maybe']
      }
    );

    event.sender.send(
      request.responseChannel,
      { result }
    );
  }
}
