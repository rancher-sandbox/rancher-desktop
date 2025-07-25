import { expect } from '@playwright/test';

import type { Locator, Page } from '@playwright/test';

type ActionString = 'browse' | 'delete';

const VOLUME_CELL_TEST_IDS = {
  name:       'volume-name-cell',
  driver:     'volume-driver-cell',
  mountpoint: 'volume-mountpoint-cell',
  created:    'volume-created-cell',
} as const;

export class VolumesPage {
  readonly page:              Page;
  readonly table:             Locator;
  readonly namespaceSelector: Locator;
  readonly searchBox:         Locator;
  readonly errorBanner:       Locator;

  constructor(page: Page) {
    this.page = page;
    this.table = page.getByTestId('volumes-table');
    this.namespaceSelector = page.getByTestId('namespace-selector');
    this.searchBox = page.getByTestId('search-input');
    this.errorBanner = page.getByTestId('error-banner');
  }

  getVolumeRow(volumeName: string) {
    return this.page.locator(`tr.main-row[data-node-id="${ volumeName }"]`);
  }

  async waitForVolumeToAppear(volumeName: string) {
    const volumeRow = this.getVolumeRow(volumeName);
    await expect(volumeRow).toBeVisible({ timeout: 15000 });
  }

  async clickVolumeAction(volumeName: string, action: ActionString) {
    const volumeRow = this.getVolumeRow(volumeName);
    const actionButton = volumeRow.locator('.btn.role-multi-action');
    await actionButton.click();

    const actionText = {
      browse: 'Browse Files',
      delete: 'Delete',
    }[action];

    const actionMenu = this.page.getByTestId('actionmenu');
    const actionLocator = actionMenu.getByText(actionText, { exact: true });
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

  getVolumeInfo(volumeName: string) {
    const volumeRow = this.getVolumeRow(volumeName);

    return {
      row:        volumeRow,
      name:       volumeRow.getByTestId(VOLUME_CELL_TEST_IDS.name),
      driver:     volumeRow.getByTestId(VOLUME_CELL_TEST_IDS.driver),
      mountpoint: volumeRow.getByTestId(VOLUME_CELL_TEST_IDS.mountpoint),
      created:    volumeRow.getByTestId(VOLUME_CELL_TEST_IDS.created),
    };
  }

  async selectBulkVolumes(volumeNames: string[]) {
    for (const volumeName of volumeNames) {
      const volumeRow = this.getVolumeRow(volumeName);
      const checkbox = volumeRow.locator('.selection-checkbox');

      await checkbox.click();
      await expect(volumeRow.locator('input[type="checkbox"]')).toBeChecked();
    }
  }

  async clickBulkDelete() {
    // Use the direct delete button that appears when items are selected
    const deleteButton = this.page.getByRole('button', { name: 'Delete' }).first();
    await deleteButton.click();
  }

  async deleteBulkVolumes(volumeNames: string[]) {
    await this.selectBulkVolumes(volumeNames);
    await this.clickBulkDelete();
  }
}
