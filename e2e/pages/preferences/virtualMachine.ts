import { Page, Locator } from 'playwright';

export class VirtualMachineNav {
  readonly page: Page;
  readonly nav: Locator;
  readonly memory: Locator;
  readonly cpus: Locator;

  constructor(page: Page) {
    this.page = page;
    this.nav = page.locator('[data-test="nav-virtual-machine"]');
    this.memory = page.locator('#memoryInGBWrapper');
    this.cpus = page.locator('#numCPUWrapper');
  }
}
