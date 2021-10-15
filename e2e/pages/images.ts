import { SpectronClient } from 'spectron';
import { BrowserWindow } from 'electron';

export default class ImagesPage {
    client: SpectronClient;
    browserWindow: BrowserWindow;
    mainTitleSelector = '[data-test="mainTitle"]';
    imagesTableSelector = '[data-test="imagesTable"]';

    constructor(client: SpectronClient, browserWindow: BrowserWindow) {
      this.client = client;
      this.browserWindow = browserWindow;
    }

    async getMainTitle() {
      await this.client.waitUntilTextExists(`${ this.mainTitleSelector }`, 'Images', 10_000);

      return await (await this.client.$(this.mainTitleSelector)).getText();
    }

    async getImagesTable() {
      return await (await this.client.$(this.imagesTableSelector)).isExisting();
    }
}
