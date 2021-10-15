import { SpectronClient } from 'spectron';
import { BrowserWindow } from 'electron';

export default class KubernetesPage {
    client: SpectronClient;
    browserWindow: BrowserWindow;
    mainTitleSelector = '[data-test="mainTitle"]';
    resetKubernetesButtonSelector = '[data-test="k8sResetBtn"]';
    k8sVersionDropDownSelector = '.select-k8s-version';
    k8sMemoryConfigSelector = '#memoryInGBWrapper';
    k8sCpuConfigSelector = '#numCPUWrapper';
    k8sPortConfigSelector = '[data-test="portConfig"]';

    constructor(client: SpectronClient, browserWindow: BrowserWindow) {
      this.client = client;
      this.browserWindow = browserWindow;
    }

    async getMainTitle() {
      await this.client.waitUntilTextExists(`${ this.mainTitleSelector }`, 'Kubernetes Settings', 10_000);

      return await (await this.client.$(this.mainTitleSelector)).getText();
    }

    async getK8sVersionDropDown() {
      return await (await this.client.$(this.k8sVersionDropDownSelector)).isExisting();
    }

    async getK8sMemoryConfig() {
      return await (await this.client.$(this.k8sMemoryConfigSelector)).isExisting();
    }

    async getK8sPortConfig() {
      return await (await this.client.$(this.k8sPortConfigSelector)).isExisting();
    }

    async getK8sCpuConfig() {
      return await (await this.client.$(this.k8sCpuConfigSelector)).isExisting();
    }

    async getResetKubernetesButtonText() {
      return await (await this.client.$(this.resetKubernetesButtonSelector)).getText();
    }
}
