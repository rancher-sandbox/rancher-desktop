import type { Page, Locator } from '@playwright/test';

export class ExtensionsPage {
  readonly page: Page;
  readonly cardEpinio: Locator;
  readonly buttonInstall: Locator;

  constructor(page: Page) {
    this.page = page;
    this.cardEpinio = page.locator('[data-test="extension-card-epinio"]');
    this.buttonInstall = page.locator('[data-test="button-install"]');
  }
}
