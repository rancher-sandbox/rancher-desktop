import { Page, Locator } from 'playwright';

export class DiagnosticsPage {
  readonly page: Page;
  readonly diagnostics: Locator;

  constructor(page: Page) {
    this.page = page;
    this.diagnostics = page.locator('[data-test="diagnostics"]');
  }
}
