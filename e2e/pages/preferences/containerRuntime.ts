import { Page, Locator } from 'playwright';

export class ContainerRuntimeNav {
  readonly page: Page;
  readonly nav: Locator;
  readonly containerRuntime: Locator;

  constructor(page: Page) {
    this.page = page;
    this.nav = page.locator('[data-test="navContainer Runtime"]');
    this.containerRuntime = page.locator('[data-test="containerRuntime"]');
  }
}
