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
    this.table = page.getByTestId('volumes-table');
    this.namespaceSelector = page.getByTestId('namespace-selector');
    this.searchBox = page.getByTestId('search-input');
    this.errorBanner = page.getByTestId('error-banner');
  }

  getVolumeRow(volumeName: string) {
    return this.page.locator(`tr.main-row[data-node-id="${volumeName}"]`);
  }

  async waitForVolumeToAppear(volumeName: string) {
    const volumeRow = this.getVolumeRow(volumeName);
    await expect(volumeRow).toBeVisible();
  }

  async clickVolumeAction(volumeName: string, action: string) {
    const volumeRow = this.getVolumeRow(volumeName);
    const actionButton = volumeRow.getByTestId('row-action-button');
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
    await expect(this.table).toBeVisible();
  }

  async isVolumePresent(volumeName: string): Promise<boolean> {
    const row = this.getVolumeRow(volumeName);
    return await row.isVisible().catch(() => false);
  }

  async searchVolumes(searchTerm: string) {
    await this.searchBox.fill(searchTerm);
  }

  async getVolumeInfo(volumeName: string) {
    const volumeRow = this.getVolumeRow(volumeName);

    await expect(volumeRow).toBeVisible();

    const volumeNameCell = volumeRow.getByTestId('volume-name-cell');
    const driverCell = volumeRow.getByTestId('volume-driver-cell');
    const mountpointCell = volumeRow.getByTestId('volume-mountpoint-cell');
    const createdCell = volumeRow.getByTestId('volume-created-cell');

    return {
      name: await volumeNameCell.textContent().then(t => t?.trim() || ''),
      driver: await driverCell.textContent().then(t => t?.trim() || ''),
      mountpoint: await mountpointCell.textContent().then(t => t?.trim() || ''),
      created: await createdCell.textContent().then(t => t?.trim() || '')
    };
  }

  async isErrorDisplayed(): Promise<boolean> {
    return await this.errorBanner.isVisible().catch(() => false);
  }

  async getErrorMessage(): Promise<string | null> {
    try {
      await expect(this.errorBanner).toBeVisible({ timeout: 1000 });
      return await this.errorBanner.textContent();
    } catch {
      return null;
    }
  }


  async selectBulkVolumes(volumeNames: string[]) {
    for (const volumeName of volumeNames) {
      const volumeRow = this.getVolumeRow(volumeName);
      const checkbox = volumeRow.getByTestId('row-selection-checkbox');

      await checkbox.click();
      await expect(volumeRow.locator('input[type="checkbox"]')).toBeChecked();
    }
  }

  async clickBulkAction(action: string) {
    if (action === 'delete') {
      const deleteButton = this.page.getByRole('button', {name: 'Delete'}).first();
      await deleteButton.click();
    } else {
      const bulkActionButton = this.page.getByTestId('bulk-action-button');
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
