import { Page, Locator } from 'playwright';

export class ImagesPage {
    readonly page: Page;
    readonly fixedHeader: Locator;
    readonly table: Locator;

    constructor(page: Page) {
      this.page = page;
      this.fixedHeader = page.locator('.fixed-header-actions');
      this.table = page.locator('[data-test="imagesTable"]');
    }
}
