import type { Page, Locator } from '@playwright/test';
export class PortForwardPage {
  readonly page: Page;
  readonly fixedHeader: Locator;
  readonly content: Locator;
  readonly table: Locator;

  constructor(page: Page) {
    this.page = page;
    this.content = page.locator('.body > .content');
    this.table = this.content.getByTestId('sortable-table-list-container')
    this.fixedHeader = this.table.locator('.fixed-header-actions');
  }
}
