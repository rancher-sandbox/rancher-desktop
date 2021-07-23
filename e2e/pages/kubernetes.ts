import { SpectronClient } from 'spectron';
import { BrowserWindow } from 'electron';

export default class KubernetesPage {
    client: SpectronClient;
    browserWindow: BrowserWindow;
    resetKubernetesButtonSelector = 'button.btn.role-secondary';

    constructor(client: SpectronClient, browserWindow: BrowserWindow) {
      this.client = client;
      this.browserWindow = browserWindow;
    }

    async getResetKubernetesButtonText() {
      return await (await this.client.$(this.resetKubernetesButtonSelector)).getText();
    }
}
