import type { Page, Locator } from '@playwright/test';

export class WslNav {
  readonly page:            Page;
  readonly nav:             Locator;
  readonly wslIntegrations: Locator;
  readonly addressTitle:    Locator;
  readonly tabIntegrations: Locator;
  readonly tabProxy:        Locator;

  constructor(page: Page) {
    this.page = page;
    this.nav = page.locator('[data-test="nav-wsl"]');
    this.tabIntegrations = page.locator('.tab >> text=Integrations');
    this.tabProxy = page.locator('.tab >> text=Proxy');
    this.wslIntegrations = page.locator('[data-test="wslIntegrations"]');
    this.addressTitle = page.locator('[data-test="addressTitle"]');
  }
}
