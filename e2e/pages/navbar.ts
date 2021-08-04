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
      const navItem = await this.client.$(`.nav li[item="/${ item }"] a`);

      if (await navItem.isExisting()) {
        await navItem.click();
        await this.client.waitUntilWindowLoaded(60_000);

        return navItem;
      } else {
        return null;
      }
    }

    async getGeneralPage() {
      const navItem = await this.clickOnNavBarItem('General');

      return navItem ? new GeneralPage(this.client, this.browserWindow) : null as any;
    }

    async getKubernetesPage() {
      const navItem = await this.clickOnNavBarItem('K8s');

      return navItem ? new KubernetesPage(this.client, this.browserWindow) : null as any;
    }

    async getImagesPage() {
      const navItem = await this.clickOnNavBarItem('Images');

      return navItem ? new ImagesPage(this.client, this.browserWindow) : null as any;
    }

    async getPortForwardingPage() {
      const navItem = await this.clickOnNavBarItem('PortForwarding');

      return navItem ? new PortForwardingPage(this.client, this.browserWindow) : null as any;
    }

    async getTroubleshootingPage() {
      const navItem = await this.clickOnNavBarItem('Troubleshooting');

      return navItem ? new TroubleshootingPage(this.client, this.browserWindow) : null as any;
    }
}
