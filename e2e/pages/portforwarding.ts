import { SpectronClient } from 'spectron';
import { BrowserWindow } from 'electron';

export default class PortForwardingPage {
    client: SpectronClient;
    browserWindow: BrowserWindow;
    rowSelector = 'tr[data-node-id="rd-nginx-demo/nginx-app:http"]';
    portForwardButtonSelector = 'button.btn.role-tertiary';
    locaPortFieldSelector = 'td[data-title="Local Port"]';

    constructor(client: SpectronClient, browserWindow: BrowserWindow) {
      this.client = client;
      this.browserWindow = browserWindow;
    }

    async portForward() {
      const table = await this.client.$('#tblPortForwarding');
      const row = await table.$(this.rowSelector);
      const portForwardButton = await row.$(this.portForwardButtonSelector);

      await portForwardButton.click();
      const port = await (await row.$(this.locaPortFieldSelector)).getText();

      return port.trim();
    }
}
