import { Page, Locator } from 'playwright';
import { expect } from '@playwright/test';

export class WslPage {
    readonly page: Page;
    readonly wslDescription: Locator;

    constructor(page: Page) {
      this.page = page;
      this.wslDescription = page.locator('.description');
    }
}
