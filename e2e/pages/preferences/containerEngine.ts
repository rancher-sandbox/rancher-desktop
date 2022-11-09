import { Page, Locator } from 'playwright';

export class ContainerEngineNav {
  readonly page: Page;
  readonly nav: Locator;
  readonly tabGeneral: Locator;
  readonly tabAllowedImages: Locator;
  readonly containerEngine: Locator;
  readonly allowedImages: Locator;

  constructor(page: Page) {
    this.page = page;
    this.nav = page.locator('[data-test="nav-container-engine"]');
    this.tabGeneral = page.locator('.tab >> text=General');
    this.tabAllowedImages = page.locator('.tab >> text=Allowed Images');
    this.containerEngine = page.locator('[data-test="containerEngine"]');
    this.allowedImages = page.locator('[data-test="allowedImages"]');
  }
}
