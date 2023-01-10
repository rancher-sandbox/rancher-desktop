import { Page, Locator } from '@playwright/test';

import { DiagnosticsPage } from './diagnostics-page';
import { ImagesPage } from './images-page';
import { K8sPage } from './k8s-page';
import { PortForwardPage } from './portforward-page';
import { TroubleshootingPage } from './troubleshooting-page';
import { WSLIntegrationsPage } from './wsl-integrations-page';

const pageConstructors = {
  K8s:             (page: Page) => new K8sPage(page),
  WSLIntegrations: (page: Page) => new WSLIntegrationsPage(page),
  PortForwarding:  (page: Page) => new PortForwardPage(page),
  Images:          (page: Page) => new ImagesPage(page),
  Troubleshooting: (page: Page) => new TroubleshootingPage(page),
  Diagnostics:     (page: Page) => new DiagnosticsPage(page),
};

export class NavPage {
  readonly page: Page;
  readonly progressBar: Locator;
  readonly mainTitle: Locator;
  readonly preferencesButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.mainTitle = page.locator('[data-test="mainTitle"]');
    this.progressBar = page.locator('.progress');
    this.preferencesButton = page.locator('.header-actions button');
  }

  /**
   * This process wait the progress bar to be visible and then
   * waits until the progress bar be detached/hidden.
   * This is a workaround until we implement:
   * https://github.com/rancher-sandbox/rancher-desktop/issues/1217
   */
  async progressBecomesReady() {
    const timeout = 400_000;

    // Wait until progress bar show up. It takes roughly ~60s to start in CI
    await this.progressBar.waitFor({ state: 'visible', timeout });
    // Wait until progress bar be detached. With that we can make sure the services were started
    // This seems to sometimes return too early; actually check the result.
    while (await this.progressBar.count() > 0) {
      await this.progressBar.waitFor({ state: 'detached', timeout: Math.round(timeout * 0.6) });
    }
  }

  /**
   * Navigate to a given tab, returning the page object model appropriate for
   * the destination tab.
   */
  async navigateTo<pageName extends keyof typeof pageConstructors>(tab: pageName):
      Promise<ReturnType<typeof pageConstructors[pageName]>>;

  async navigateTo(tab: keyof typeof pageConstructors) {
    await this.page.click(`.nav li[item="/${ tab }"] a`);
    await this.page.waitForURL(`**/${ tab }`, { timeout: 60_000 });

    return pageConstructors[tab](this.page);
  }
}
