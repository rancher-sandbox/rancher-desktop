import { Application, SpectronClient } from 'spectron';
import { BrowserWindow } from 'electron';

export default class FirstRunPage {
  client: SpectronClient;
  browserWindow: BrowserWindow;
  k8sHeaderSelector = '[data-test="k8s-settings-header"]';

  constructor(app: Application) {
    this.client = app.client;
    this.browserWindow = app.browserWindow;
  }

  async getK8sVersionHeaderText() {
    return await (await this.client.$(this.k8sHeaderSelector)).getText();
  }
}
