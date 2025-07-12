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

  async clearSearch() {
    await this.searchInput.press('Escape');
  }


  async getTerminalContent(): Promise<string> {
    const terminalRows = this.page.locator('.xterm-rows');
    return await terminalRows.textContent() || '';
  }

  async scrollToBottom() {
    await this.terminal.press('End');
  }

  async scrollToTop() {
    await this.terminal.press('Home');
  }
}
