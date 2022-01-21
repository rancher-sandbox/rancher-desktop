import { Page, Locator } from 'playwright';
import { expect } from '@playwright/test';

export class PortForwardPage {
    readonly page: Page;
    readonly portForwardingContentSelector: Locator;

    constructor(page: Page) {
      this.page = page;
      this.portForwardingContentSelector = page.locator('.content');
    }

    async getPortForwardDescription() {
      await expect(this.portForwardingContentSelector).toBeVisible();
    }
}
