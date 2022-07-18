import { Page, Locator } from 'playwright';

export class WslNav {
  readonly page: Page;
  readonly nav: Locator;

  constructor(page: Page) {
    this.page = page;
    this.nav = page.locator('[data-test="navWSL"]');
  }
}
