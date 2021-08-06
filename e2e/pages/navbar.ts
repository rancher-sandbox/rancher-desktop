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

    /**
     * Give the page path (name), return the page object.
     * @param path The page path; this is the *.vue file name.
     * @param ctor Constructor for the page object.
     * @returns The page object, or null if not found.
     */
    protected async getPage<T>(path: string, ctor: new (client: SpectronClient, window: BrowserWindow) => T) {
      const navItem = await this.client.$(`.nav li[item="/${ path }"] a`);

      if (!await navItem.isExisting()) {
        return null;
      }
      await navItem.click();
      await this.client.waitUntilWindowLoaded(60_000);

      return new ctor(this.client, this.browserWindow);
    }

    async getGeneralPage() {
      return await this.getPage('General', GeneralPage);
    }

    async getKubernetesPage() {
      return await this.getPage('K8s', KubernetesPage);
    }

    async getImagesPage() {
      return await this.getPage('Images', ImagesPage);
    }

    async getPortForwardingPage() {
      return await this.getPage('PortForwarding', PortForwardingPage);
    }

    async getTroubleshootingPage() {
      return await this.getPage('Troubleshooting', TroubleshootingPage);
    }
}
