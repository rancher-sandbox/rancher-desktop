import { Application, SpectronClient } from 'spectron';
import { BrowserWindow } from 'electron';

import GeneralPage from './general';
import KubernetesPage from './kubernetes';
import ImagesPage from './images';
import PortForwardingPage from './portforwarding';
import TroubleshootingPage from './troubleshooting';

export default class NavBarPage {
    client: SpectronClient;
    browserWindow: BrowserWindow;

    constructor(app: Application) {
      this.client = app.client;
      this.browserWindow = app.browserWindow;
    }

    async clickOnNavBarItem(item: string) {
      await (await this.client.$(`.nav li[item="/${ item }"] a`)).click();
      await this.client.waitUntilWindowLoaded(60_000);
    }

    async getGeneralPage() {
      await this.clickOnNavBarItem('General');

      return new GeneralPage(this.client, this.browserWindow);
    }

    async getKubernetesPage() {
      await this.clickOnNavBarItem('K8s');

      return new KubernetesPage(this.client, this.browserWindow);
    }

    async getImagesPage() {
      await this.clickOnNavBarItem('PortForwarding');

      return new ImagesPage(this.client, this.browserWindow);
    }

    async getPortForwardingPage() {
      await this.clickOnNavBarItem('Images');

      return new PortForwardingPage(this.client, this.browserWindow);
    }

    async getTroubleshootingPage() {
      await this.clickOnNavBarItem('Troubleshooting');

      return new TroubleshootingPage(this.client, this.browserWindow);
    }
}
