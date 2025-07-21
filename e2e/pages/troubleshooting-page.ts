import type { Page, Locator } from '@playwright/test';

export class TroubleshootingPage {
  readonly page:               Page;
  readonly factoryResetButton: Locator;
  readonly logsButton:         Locator;
  readonly troubleshooting:    Locator;

  constructor(page: Page) {
    this.page = page;
    this.factoryResetButton = page.locator('[data-test="factoryResetButton"]');
    this.logsButton = page.locator('[data-test="logsButton"]');
    this.troubleshooting = page.locator('.troubleshooting');
  }
}
