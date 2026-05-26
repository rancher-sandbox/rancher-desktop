import { expect } from '@playwright/test';

import type { Locator, Page } from '@playwright/test';

export class ContainerInfoPage {
  readonly page:           Page;
  readonly tab:            Locator;
  readonly summaryTable:   Locator;
  readonly loadingSpinner: Locator;
  readonly errorMessage:   Locator;
  readonly mountsSection:  Locator;
  readonly envSection:     Locator;
  readonly commandSection: Locator;
  readonly capsSection:    Locator;
  readonly portsSection:   Locator;
  readonly labelsSection:  Locator;

  constructor(page: Page) {
    this.page = page;
    this.tab = page.getByTestId('tab-info');
    this.summaryTable = page.getByTestId('info-summary-table');
    this.loadingSpinner = page.getByTestId('info-loading');
    this.errorMessage = page.getByTestId('info-error');
    this.mountsSection = page.getByTestId('info-section-mounts');
    this.envSection = page.getByTestId('info-section-env');
    this.commandSection = page.getByTestId('info-section-command');
    this.capsSection = page.getByTestId('info-section-capabilities');
    this.portsSection = page.getByTestId('info-section-ports');
    this.labelsSection = page.getByTestId('info-section-labels');
  }

  async clickTab() {
    await this.tab.click();
  }

  async waitForData(timeout = 15_000) {
    await expect(this.loadingSpinner).toBeHidden({ timeout });
    await expect(this.summaryTable).toBeVisible({ timeout });
  }

  /**
   * Read the value cell of a summary row by its data-testid.
   * E.g. getSummaryValue('info-row-name') returns the container name.
   */
  async getSummaryValue(rowTestId: string): Promise<string> {
    const td = this.page.getByTestId(rowTestId).locator('td');

    return (await td.textContent())?.trim() ?? '';
  }
}
