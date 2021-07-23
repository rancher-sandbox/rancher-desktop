import { SpectronClient } from 'spectron';
import { BrowserWindow } from 'electron';

export default class ImagesPage {
    client: SpectronClient;
    browserWindow: BrowserWindow;

    constructor(client: SpectronClient, browserWindow: BrowserWindow) {
      this.client = client;
      this.browserWindow = browserWindow;
    }
}
