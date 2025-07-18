import { Locator, Page } from '@playwright/test';

export class SnapshotsPage {
  readonly page:                    Page;
  readonly snapshotsPage:           Locator;
  readonly createSnapshotButton:    Locator;
  readonly createSnapshotNameInput: Locator;
  readonly createSnapshotDescInput: Locator;

  constructor(page: Page) {
    this.page = page;
    this.snapshotsPage = page.locator('[data-test="snapshotsPage"]');
    this.createSnapshotButton = page.locator('[data-test="createSnapshotButton"]');
    this.createSnapshotNameInput = page.locator('[data-test="createSnapshotNameInput"]');
    this.createSnapshotDescInput = page.locator('[data-test="createSnapshotDescInput"]');
  }
}
