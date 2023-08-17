import type { Page, Locator } from '@playwright/test';

export class VirtualMachineNav {
  readonly page: Page;
  readonly nav: Locator;
  readonly memory: Locator;
  readonly cpus: Locator;
  readonly mountType: Locator;
  readonly reverseSshFs: Locator;
  readonly ninep: Locator;
  readonly virtiofs: Locator;
  readonly cacheMode: Locator;
  readonly msizeInKib: Locator;
  readonly protocolVersion: Locator;
  readonly securityModel: Locator;
  readonly networkingTunnel: Locator;
  readonly vmType: Locator;
  readonly qemu: Locator;
  readonly vz: Locator;
  readonly useRosetta: Locator;
  readonly vzNAT: Locator;
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
    this.reverseSshFs = page.locator('[data-test="reverse-sshfs"]');
    this.ninep = page.locator('[data-test="9p"]');
    this.virtiofs = page.locator('[data-test="virtiofs"]');
    this.cacheMode = page.locator('[data-test="cacheMode"]');
    this.msizeInKib = page.locator('[data-test="msizeInKib"]');
    this.protocolVersion = page.locator('[data-test="protocolVersion"]');
    this.securityModel = page.locator('[data-test="securityModel"]');
    this.networkingTunnel = page.locator('[data-test="networkingTunnel"]');
    this.vmType = page.locator('[data-test="vmType"]');
    this.qemu = page.locator('[data-test="QEMU"]');
    this.vz = page.locator('[data-test="VZ"]');
    this.useRosetta = page.locator('[data-test="useRosetta"]');
    this.vzNAT = page.locator('[data-test="vzNAT"]');
    this.socketVmNet = page.locator('[data-test="socketVmNet"]');
    this.tabHardware = page.locator('.tab >> text=Hardware');
    this.tabVolumes = page.locator('.tab >> text=Volumes');
    this.tabNetwork = page.locator('.tab >> text=Network');
    this.tabEmulation = page.locator('.tab >> text=Emulation');
  }
}
