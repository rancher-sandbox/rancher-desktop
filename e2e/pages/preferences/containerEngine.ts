import type { Page, Locator } from '@playwright/test';

export class ContainerEngineNav {
  readonly page:                  Page;
  readonly nav:                   Locator;
  readonly tabGeneral:            Locator;
  readonly tabAllowedImages:      Locator;
  readonly containerEngine:       Locator;
  readonly allowedImages:         Locator;
  readonly allowedImagesCheckbox: Locator;
  readonly enabledLockedField:    Locator;

  constructor(page: Page) {
    this.page = page;
    this.nav = page.locator('[data-test="nav-container-engine"]');
    this.tabGeneral = page.locator('.tab >> text=General');
    this.tabAllowedImages = page.locator('.tab >> text=Allowed Images');
    this.containerEngine = page.locator('[data-test="containerEngine"]');
    this.allowedImages = page.locator('[data-test="allowedImages"]');
    this.allowedImagesCheckbox = page.getByTestId('allowedImagesCheckbox');
    this.enabledLockedField = this.allowedImagesCheckbox.locator('.icon-lock');
  }
}
