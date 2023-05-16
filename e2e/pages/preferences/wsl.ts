import type { Page, Locator } from '@playwright/test';

export class WslNav {
  readonly page: Page;
  readonly nav: Locator;
  readonly networkingTunnel: Locator;
  readonly tabIntegrations: Locator;
  readonly tabNetwork: Locator;
  readonly wslIntegrations: Locator;

  constructor(page: Page) {
    this.page = page;
    this.nav = page.locator('[data-test="nav-wsl"]');
    this.networkingTunnel = page.locator('[data-test="networkingTunnel"]');
    this.tabIntegrations = page.locator('.tab >> text=Integrations');
    this.tabNetwork = page.locator('.tab >> text=Network');
    this.wslIntegrations = page.locator('[data-test="wslIntegrations"]');
  }
}
