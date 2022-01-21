import { Page, Locator } from 'playwright';
import { expect } from '@playwright/test';

export class WslPage {
    readonly page: Page;
    readonly wslDescriptionSelector: Locator;

    constructor(page: Page) {
      this.page = page;
      this.wslDescriptionSelector = page.locator('.description');
    }

    async getWslDescription() {
      await expect(this.wslDescriptionSelector).toBeVisible();
    }
}
