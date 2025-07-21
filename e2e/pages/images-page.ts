import type { Page, Locator } from '@playwright/test';

export class ImagesPage {
  readonly page:        Page;
  readonly fixedHeader: Locator;
  readonly table:       Locator;
  readonly rows:        Locator;

  constructor(page: Page) {
    this.page = page;
    this.fixedHeader = page.locator('.fixed-header-actions');
    this.table = page.locator('[data-test="imagesTable"]');
    this.rows = page.locator('[data-test="imagesTableRows"]');
  }
}
