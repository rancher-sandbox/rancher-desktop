import { SpectronClient } from 'spectron';
import { BrowserWindow } from 'electron';

export default class GeneralPage {
    client: SpectronClient;
    browserWindow: BrowserWindow;
    titleSelector = '.general h1';

    constructor(client: SpectronClient, browserWindow: BrowserWindow) {
      this.client = client;
      this.browserWindow = browserWindow;
    }

    async getTitle() {
      return await (await this.client.$(this.titleSelector)).getText();
    }
}
