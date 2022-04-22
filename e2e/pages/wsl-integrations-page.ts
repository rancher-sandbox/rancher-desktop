import { Page, Locator } from 'playwright';

export class WSLIntegrationsPage {
  readonly page: Page;
  readonly description: Locator;
  readonly mainTitle: Locator;

  constructor(page: Page) {
    this.page = page;
    this.mainTitle = page.locator('[data-test="mainTitle"]');
    this.description = page.locator('.description');
  }
}
