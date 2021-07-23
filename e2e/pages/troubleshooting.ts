import { SpectronClient } from 'spectron';
import { BrowserWindow } from 'electron';

export default class TroubleshootingPage {
    client: SpectronClient;
    browserWindow: BrowserWindow;
    factoryResetButtonSelector = '#btnTroubleShootingFactoryReset';

    constructor(client: SpectronClient, browserWindow: BrowserWindow) {
      this.client = client;
      this.browserWindow = browserWindow;
    }

    async getFactoryResetButtonText() {
      return await (await this.client.$(this.factoryResetButtonSelector)).getText();
    }
}
