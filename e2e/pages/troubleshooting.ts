import { SpectronClient } from 'spectron';
import { BrowserWindow } from 'electron';

export default class TroubleshootingPage {
    client: SpectronClient;
    browserWindow: BrowserWindow;
    mainTitleSelector = '[data-test="mainTitle"]';
    troubleShootingDashboardSelector = '.dashboard';
    logsButtonSelector = '[data-test="logsButton"]';
    factoryResetButtonSelector = '[data-test="factoryResetButton"]';

    constructor(client: SpectronClient, browserWindow: BrowserWindow) {
      this.client = client;
      this.browserWindow = browserWindow;
    }

    async getMainTitle() {
      await this.client.waitUntilTextExists(`${ this.mainTitleSelector }`, 'Troubleshooting', 10_000);

      return await (await this.client.$(this.mainTitleSelector)).getText();
    }

    async getTroubleshootingDashboard() {
      return await (await this.client.$(this.troubleShootingDashboardSelector)).isExisting();
    }

    async getLogsButton() {
      return await (await this.client.$(this.logsButtonSelector)).isExisting();
    }

    async getFactoryResetButton() {
      return await (await this.client.$(this.factoryResetButtonSelector)).isExisting();
    }
}
