import { Page, Locator } from 'playwright';

export class TroubleshootingPage {
    readonly page: Page;
    readonly factoryResetButton: Locator;
    readonly logsButton: Locator;
    readonly dashboard: Locator;

    constructor(page: Page) {
      this.page = page;
      this.factoryResetButton = page.locator('[data-test="factoryResetButton"]');
      this.logsButton = page.locator('[data-test="logsButton"]');
      this.dashboard = page.locator('.dashboard');
    }
}
