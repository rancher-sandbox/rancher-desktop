import type { Page, Locator } from '@playwright/test';
export class PortForwardPage {
  readonly page: Page;
  readonly fixedHeader: Locator;
  readonly content: Locator;
  readonly table: Locator;

  constructor(page: Page) {
    this.page = page;
    this.fixedHeader = page.locator('.fixed-header-actions');
    this.table = page.locator('.sortable-table-header');
    this.content = page.locator('.content');
  }
}
