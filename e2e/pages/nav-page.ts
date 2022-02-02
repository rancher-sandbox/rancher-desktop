import { Page, Locator } from 'playwright';
import { K8sPage } from './k8s-page';
import { PortForwardPage } from './portforward-page';
import { IntegrationsPage } from './integrations-page';
import { ImagesPage } from './images-page';
import { TroubleshootingPage } from './troubleshooting-page';

const pageConstructors = {
  K8s:             (page: Page) => new K8sPage(page),
  Integrations:    (page: Page) => new IntegrationsPage(page),
  PortForwarding:  (page: Page) => new PortForwardPage(page),
  Images:          (page: Page) => new ImagesPage(page),
  Troubleshooting: (page: Page) => new TroubleshootingPage(page),
};

export class NavPage {
    readonly page: Page;
    readonly progressBar: Locator;
    readonly mainTitle: Locator;

    constructor(page: Page) {
      this.page = page;
      this.mainTitle = page.locator('[data-test="mainTitle"]');
      this.progressBar = page.locator('.progress');
    }

    /**
     * This process wait the progress bar to be visible and then
     * waits until the progress bar be detached/hidden.
     * This is a workaround until we implement:
     * https://github.com/rancher-sandbox/rancher-desktop/issues/1217
     */
    async progressBecomesReady() {
      // Wait until progress bar show up. It takes roughly ~60s to start in CI
      await this.progressBar.waitFor({ state: 'visible', timeout: 200_000 });
      // Wait until progress bar be detached. With that we can make sure the services were started
      await this.progressBar.waitFor({ state: 'detached', timeout: 120_000 });
    }

    /**
     * Navigate to a given tab, returning the page object model appropriate for
     * the destination tab.
     */
    async navigateTo<pageName extends keyof typeof pageConstructors>(tab: pageName):
      Promise<ReturnType<typeof pageConstructors[pageName]>>;

    async navigateTo(tab: keyof typeof pageConstructors) {
      await this.page.click(`.nav li[item="/${ tab }"] a`);
      await this.page.waitForNavigation({ url: `**/${ tab }`, timeout: 60_000 });

      return pageConstructors[tab](this.page);
    }
}
