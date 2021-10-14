import { SpectronClient } from 'spectron';
import { BrowserWindow } from 'electron';

export default class KubernetesPage {
    client: SpectronClient;
    browserWindow: BrowserWindow;
    mainTitleSelector = '[data-test="mainTitle"]';
    resetKubernetesButtonSelector = '[data-test="k8sResetBtn"]';

    constructor(client: SpectronClient, browserWindow: BrowserWindow) {
      this.client = client;
      this.browserWindow = browserWindow;
    }

    async getMainTitle() {
      return await (await this.client.$(this.mainTitleSelector)).getText();
    }

    async getResetKubernetesButtonText() {
      return await (await this.client.$(this.resetKubernetesButtonSelector)).getText();
    }
}
