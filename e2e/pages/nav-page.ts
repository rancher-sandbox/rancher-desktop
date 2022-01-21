import { Page, Locator } from 'playwright';
import { expect } from '@playwright/test';

export class NavPage {
    readonly page: Page;
    readonly progressBarSelector: Locator;
    readonly mainTitleSelector: Locator;

    constructor(page: Page) {
      this.page = page;
      this.mainTitleSelector = page.locator('[data-test="mainTitle"]');
      this.progressBarSelector = page.locator('.progress');
    }

    async getGeneralPageTile(content: string) {
      await expect(this.mainTitleSelector).toHaveText(content);
    }

    async getProgressBar() {
      // Wait until progress bar show up. It takes roughly ~60s to start in CI
      await this.progressBarSelector.waitFor({ state: 'visible', timeout: 200_000 });
      // Wait until progress bar be detached. With that we can make sure the services were started
      await this.progressBarSelector.waitFor({ state: 'detached', timeout: 120_000 });
      await expect(this.progressBarSelector).toBeHidden();
    }

    async navigateTo(tab: string) {
      return await Promise.all([
        this.page.click(`.nav li[item="/${ tab }"] a`),
        this.page.waitForNavigation({ url: `**/${ tab }`, timeout: 60_000 }),
      ]);
    }
}
