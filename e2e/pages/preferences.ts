import { Page, Locator } from 'playwright';

export class PreferencesPage {
  readonly page: Page;
  readonly description: Locator;
  readonly mainTitle: Locator;
  readonly integrations: Locator;

  constructor(page: Page) {
    this.page = page;
    this.mainTitle = page.locator('[data-test="mainTitle"]');
    this.description = page.locator('.description');
    this.integrations = page.locator('[data-test="integration-list"]');
  }
}
