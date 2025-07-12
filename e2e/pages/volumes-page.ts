import type {Locator, Page} from '@playwright/test';
import {expect} from '@playwright/test';

export class VolumesPage {
  readonly page: Page;
  readonly table: Locator;
  readonly namespaceSelector: Locator;
  readonly searchBox: Locator;
  readonly errorBanner: Locator;

  constructor(page: Page) {
    this.page = page;
    this.table = page.locator('.volumesTable');
    this.namespaceSelector = page.locator('.select-namespace');
    this.searchBox = page.locator('.search-box input');
    this.errorBanner = page.locator('.banner.error');
  }

  getVolumeRow(volumeName: string) {
    return this.page.locator(`tr.main-row[data-node-id="${volumeName}"]`);
  }

  async waitForVolumeToAppear(volumeName: string, timeout = 30000) {
    const volumeRow = this.getVolumeRow(volumeName);
    await expect(volumeRow).toBeVisible();
  }

  async clickVolumeAction(volumeName: string, action: string) {
    const volumeRow = this.getVolumeRow(volumeName);
    const actionButton = volumeRow.locator('.btn.role-multi-action');
    await actionButton.click();

    const actionText = {
      browse: 'Browse Files',
      delete: 'Delete',
    }[action] ?? action;

    const actionMenu = this.page.getByTestId("actionmenu");
    const actionLocator = actionMenu.getByText(actionText, {exact: true});
    await actionLocator.click();
  }

  async browseVolumeFiles(volumeName: string) {
    await this.clickVolumeAction(volumeName, 'browse');
  }

  async deleteVolume(volumeName: string) {
    await this.clickVolumeAction(volumeName, 'delete');
  }

  async getVolumeCount(): Promise<number> {
    const rows = this.page.locator('tr.main-row');
    return await rows.count();
  }

  async waitForTableToLoad() {
    await this.table.waitFor({state: 'visible'});
  }

  async isVolumePresent(volumeName: string): Promise<boolean> {
    const row = this.getVolumeRow(volumeName);
    return await row.count() > 0;
  }

  async searchVolumes(searchTerm: string) {
    if (await this.searchBox.count() > 0) {
      await this.searchBox.fill(searchTerm);
    }
  }

  async getVolumeInfo(volumeName: string) {
    const volumeRow = this.getVolumeRow(volumeName);

    await volumeRow.waitFor({state: 'visible'});

    const cells = volumeRow.locator('td');

    // The columns after checkbox are:
    // 0. Checkbox (skip)
    // 1. Volume name
    // 2. Driver
    // 3. Mount point
    // 4. Created date
    const volumeNameText = await cells.nth(1).textContent();
    const driverText = await cells.nth(2).textContent();
    const mountpointText = await cells.nth(3).textContent();
    const createdText = await cells.nth(4).textContent();

    return {
      name: volumeNameText?.trim() || '',
      driver: driverText?.trim() || '',
      mountpoint: mountpointText?.trim() || '',
      created: createdText?.trim() || ''
    };
  }

  async isErrorDisplayed(): Promise<boolean> {
    return await this.errorBanner.count() > 0;
  }

  async getErrorMessage(): Promise<string | null> {
    if (await this.isErrorDisplayed()) {
      return await this.errorBanner.textContent();
    }
    return null;
  }


  async selectBulkVolumes(volumeNames: string[]) {
    for (const volumeName of volumeNames) {
      const volumeRow = this.getVolumeRow(volumeName);
      const checkboxSpan = volumeRow.locator('span.checkbox-custom');

      await checkboxSpan.click();
      await checkboxSpan.waitFor({state: 'attached'});
    }
  }

  async clickBulkAction(action: string) {
    if (action === 'delete') {
      const deleteButton = this.page.getByRole('button', {name: 'Delete'}).first();
      await deleteButton.click();
    } else {
      const bulkActionButton = this.page.locator('.bulk .btn.role-multi-action');
      await bulkActionButton.click();

      const actionMenu = this.page.getByTestId('actionmenu');
      const actionLocator = actionMenu.getByText(action, {exact: true});
      await actionLocator.click();
    }
  }

  async deleteBulkVolumes(volumeNames: string[]) {
    await this.selectBulkVolumes(volumeNames);
    await this.clickBulkAction('delete');
  }
}
