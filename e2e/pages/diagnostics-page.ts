import type { Page, Locator } from '@playwright/test';

interface CheckerRows {
  muteButton: Locator;
}

export class DiagnosticsPage {
  readonly page:        Page;
  readonly diagnostics: Locator;

  constructor(page: Page) {
    this.page = page;
    this.diagnostics = page.locator('[data-test="diagnostics"]');
  }

  checkerRows(id: string): CheckerRows {
    return { muteButton: this.page.locator(`[data-test="diagnostics-mute-row-${ id }"]`) };
  }
}
