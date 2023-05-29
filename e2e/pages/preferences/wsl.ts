import type { Page, Locator } from '@playwright/test';

export class WslNav {
  readonly page: Page;
  readonly nav: Locator;
  readonly networkingTunnel: Locator;
  readonly wslIntegrations: Locator;
  readonly addressTitle: Locator;
  readonly tabIntegrations: Locator;
  readonly tabNetwork: Locator;
  readonly tabProxy: Locator;

  constructor(page: Page) {
    this.page = page;
    this.nav = page.locator('[data-test="nav-wsl"]');
    this.networkingTunnel = page.locator('[data-test="networkingTunnel"]');
    this.tabIntegrations = page.locator('.tab >> text=Integrations');
    this.tabNetwork = page.locator('.tab >> text=Network');
    this.tabProxy = page.locator('.tab >> text=Proxy');
    this.wslIntegrations = page.locator('[data-test="wslIntegrations"]');
    this.addressTitle = page.locator('[data-test="addressTitle"]');
  }
}
