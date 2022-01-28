import { Page, Locator } from 'playwright';
import { expect } from '@playwright/test';

export class PortForwardPage {
    readonly page: Page;
    readonly portForwardingContent: Locator;

    constructor(page: Page) {
      this.page = page;
      this.portForwardingContent = page.locator('.content');
    }
}
