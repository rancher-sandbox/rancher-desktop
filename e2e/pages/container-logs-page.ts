import type {Locator, Page} from '@playwright/test';

export class ContainerLogsPage {
  readonly page: Page;
  readonly terminal: Locator;
  readonly containerInfo: Locator;
  readonly containerName: Locator;
  readonly containerState: Locator;
  readonly searchWidget: Locator;
  readonly searchInput: Locator;
  readonly searchPrevButton: Locator;
  readonly searchNextButton: Locator;
  readonly searchClearButton: Locator;
  readonly errorMessage: Locator;
  readonly loadingIndicator: Locator;

  constructor(page: Page) {
    this.page = page;

    this.terminal = page.locator('.xterm');

    this.containerInfo = page.locator('.container-info');
    this.containerName = page.locator('.container-name');
    this.containerState = this.containerInfo.locator('.badge-state');

    this.searchWidget = page.locator('.search-widget');
    this.searchInput = page.locator('.search-input');
    this.searchPrevButton = page.getByTestId('search-prev-btn');
    this.searchNextButton = page.getByTestId('search-next-btn');
    this.searchClearButton = page.locator('.search-close-btn');

    this.loadingIndicator = page.locator('loading-indicator.content-state');
    this.errorMessage = page.locator('banner.content-state');
  }

  async waitForLogsToLoad() {
    await this.terminal.waitFor({state: 'visible'});
    await this.loadingIndicator.waitFor({state: 'hidden', timeout: 30000});
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
