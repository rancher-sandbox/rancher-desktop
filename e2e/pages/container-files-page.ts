import { expect } from '@playwright/test';

import type { Locator, Page } from '@playwright/test';

export class ContainerFilesPage {
  readonly page:           Page;
  readonly tab:            Locator;
  readonly tree:           Locator;
  readonly breadcrumbs:    Locator;
  readonly preview:        Locator;
  readonly previewText:    Locator;
  readonly binaryNotice:   Locator;
  readonly downloadButton: Locator;
  readonly refreshButton:  Locator;
  readonly errorBanner:    Locator;

  constructor(page: Page) {
    this.page = page;
    this.tab = page.getByTestId('tab-files');
    this.tree = page.getByTestId('files-tree');
    this.breadcrumbs = page.getByTestId('files-breadcrumbs');
    this.preview = page.getByTestId('files-preview');
    this.previewText = page.getByTestId('files-content');
    this.binaryNotice = page.getByTestId('files-binary');
    this.downloadButton = page.getByTestId('files-download');
    this.refreshButton = page.getByTestId('files-refresh');
    this.errorBanner = page.getByTestId('files-error');
  }

  async clickTab() {
    await this.tab.click();
  }

  /** A tree row for the given absolute container path, e.g. `/etc/hosts`. */
  node(path: string): Locator {
    return this.page.getByTestId(`files-node-${ path }`);
  }

  /** Wait for the directory tree to finish its initial load. */
  async waitForTree(timeout = 30_000) {
    await expect(this.tree.locator('li.tree-row').first()).toBeVisible({ timeout });
  }

  /** Click a directory node to expand it, then wait for a known child to appear. */
  async expandDirectory(dirPath: string, expectChild: string, timeout = 30_000) {
    await this.node(dirPath).click();
    await expect(this.node(expectChild)).toBeVisible({ timeout });
  }

  /** Select a file node to load its preview. */
  async openFile(filePath: string) {
    await this.node(filePath).click();
  }
}
