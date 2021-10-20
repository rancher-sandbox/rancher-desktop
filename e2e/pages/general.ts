import { SpectronClient } from 'spectron';
import { BrowserWindow } from 'electron';

export default class GeneralPage {
    client: SpectronClient;
    browserWindow: BrowserWindow;
    mainTitleSelector = '[data-test="mainTitle"]';

    constructor(client: SpectronClient, browserWindow: BrowserWindow) {
      this.client = client;
      this.browserWindow = browserWindow;
    }

    async getMainTitle() {
      return await (await this.client.$(this.mainTitleSelector)).getText();
    }
}
