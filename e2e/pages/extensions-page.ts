import type { Page, Locator } from '@playwright/test';

export class ExtensionsPage {
  readonly page:          Page;
  readonly cardEpinio:    Locator;
  readonly buttonInstall: Locator;
  readonly tabInstalled:  Locator;
  readonly tabCatalog:    Locator;
  readonly navEpinio:     Locator;

  constructor(page: Page) {
    this.page = page;
    this.cardEpinio = page.locator('[data-test="extension-card-epinio"]');
    this.buttonInstall = page.locator('[data-test="button-install"]');
    this.tabInstalled = page.locator('.tab >> text=Installed');
    this.tabCatalog = page.locator('.tab >> text=Catalog');
    this.navEpinio = page.locator('[data-test="extension-nav-epinio"]');
  }
}
