import { expect } from '@playwright/test';

import type { Locator, Page } from '@playwright/test';

export class ContainerStatsPage {
  readonly page:             Page;
  readonly tab:              Locator;
  readonly cpuChart:         Locator;
  readonly memoryChart:      Locator;
  readonly networkChart:     Locator;
  readonly ioChart:          Locator;
  readonly processTable:     Locator;
  readonly refreshSelect:    Locator;
  readonly notRunningBanner: Locator;

  constructor(page: Page) {
    this.page = page;
    this.tab = page.getByTestId('tab-stats');
    this.cpuChart = page.getByTestId('stats-cpu-chart');
    this.memoryChart = page.getByTestId('stats-memory-chart');
    this.networkChart = page.getByTestId('stats-network-chart');
    this.ioChart = page.getByTestId('stats-io-chart');
    this.processTable = page.getByTestId('stats-process-table');
    this.refreshSelect = page.getByTestId('stats-refresh-select');
    this.notRunningBanner = page.getByTestId('stats-not-running');
  }

  async clickTab() {
    await this.tab.click();
  }

  async waitForCharts(timeout = 20_000) {
    await expect(this.cpuChart).toBeVisible({ timeout });
    await expect(this.memoryChart).toBeVisible({ timeout });
    await expect(this.networkChart).toBeVisible({ timeout });
    await expect(this.ioChart).toBeVisible({ timeout });
  }
}
