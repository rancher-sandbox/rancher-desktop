import { Page, Locator } from 'playwright';

export class ContainerEngineNav {
  readonly page: Page;
  readonly nav: Locator;
  readonly containerEngine: Locator;

  constructor(page: Page) {
    this.page = page;
    this.nav = page.locator('[data-test="nav-container-engine"]');
    this.containerEngine = page.locator('[data-test="containerEngine"]');
  }
}
