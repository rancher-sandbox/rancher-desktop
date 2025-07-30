import { expect } from '@playwright/test';

import type { Locator, Page } from '@playwright/test';

export class ContainerLogsPage {
  readonly page:              Page;
  readonly terminal:          Locator;
  readonly containerInfo:     Locator;
  readonly containerName:     Locator;
  readonly containerState:    Locator;
  readonly searchWidget:      Locator;
  readonly searchInput:       Locator;
  readonly searchPrevButton:  Locator;
  readonly searchNextButton:  Locator;
  readonly searchClearButton: Locator;
  readonly errorMessage:      Locator;
  readonly loadingIndicator:  Locator;

  constructor(page: Page) {
    this.page = page;

    this.terminal = page.getByTestId('terminal');

    this.containerInfo = page.getByTestId('container-info');
    this.containerName = page.getByTestId('container-name');
    this.containerState = page.getByTestId('container-state');

    this.searchWidget = page.getByTestId('search-widget');
    this.searchInput = page.getByTestId('search-input');
    this.searchPrevButton = page.getByTestId('search-prev-btn');
    this.searchNextButton = page.getByTestId('search-next-btn');
    this.searchClearButton = page.getByTestId('search-clear-btn');

    this.loadingIndicator = page.getByTestId('loading-indicator');
    this.errorMessage = page.getByTestId('error-message');
  }

  async waitForLogsToLoad() {
    await expect(this.terminal).toBeVisible();
    await expect(this.loadingIndicator).toBeHidden({ timeout: 30_000 });
  }

  async searchLogs(searchTerm: string) {
    await this.searchInput.fill(searchTerm);
    await this.searchInput.press('Enter');
  }

  async scrollToBottom() {
    await this.page.evaluate(() => {
      const viewport = document.querySelector('.xterm-viewport');
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    });
  }

  async scrollToTop() {
    await this.page.evaluate(() => {
      const viewport = document.querySelector('.xterm-viewport');
      if (viewport) {
        viewport.scrollTop = 0;
      }
    });
  }

  async getScrollPosition(): Promise<number> {
    return await this.page.evaluate(() => {
      const viewport = document.querySelector('.xterm-viewport');
      return viewport ? viewport.scrollTop : 0;
    });
  }
}
