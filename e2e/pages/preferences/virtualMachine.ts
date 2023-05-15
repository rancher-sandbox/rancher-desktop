import type { Page, Locator } from '@playwright/test';

export class VirtualMachineNav {
  readonly page: Page;
  readonly nav: Locator;
  readonly memory: Locator;
  readonly cpus: Locator;
  readonly mountType: Locator;
  readonly networkingTunnel: Locator;
  readonly vmType: Locator;
  readonly socketVmNet: Locator;
  readonly tabHardware: Locator;
  readonly tabVolumes: Locator;
  readonly tabNetwork: Locator;
  readonly tabEmulation: Locator;

  constructor(page: Page) {
    this.page = page;
    this.nav = page.locator('[data-test="nav-virtual-machine"]');
    this.memory = page.locator('#memoryInGBWrapper');
    this.cpus = page.locator('#numCPUWrapper');
    this.mountType = page.locator('[data-test="mountType"]');
    this.networkingTunnel = page.locator('[data-test="networkingTunnel"]');
    this.vmType = page.locator('[data-test="vmType"]');
    this.socketVmNet = page.locator('[data-test="socketVmNet"]');
    this.tabHardware = page.locator('.tab >> text=Hardware');
    this.tabVolumes = page.locator('.tab >> text=Volumes');
    this.tabNetwork = page.locator('.tab >> text=Network');
    this.tabEmulation = page.locator('.tab >> text=Emulation');
  }
}
