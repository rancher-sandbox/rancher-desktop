import type { Page, Locator } from '@playwright/test';

export class VirtualMachineNav {
  readonly page:            Page;
  readonly nav:             Locator;
  readonly memory:          Locator;
  readonly cpus:            Locator;
  readonly mountType:       Locator;
  readonly reverseSshFs:    Locator;
  readonly ninep:           Locator;
  readonly virtiofs:        Locator;
  readonly cacheMode:       Locator;
  readonly msizeInKib:      Locator;
  readonly protocolVersion: Locator;
  readonly securityModel:   Locator;
  readonly vmType:          Locator;
  readonly qemu:            Locator;
  readonly vz:              Locator;
  readonly useRosetta:      Locator;
  readonly tabHardware:     Locator;
  readonly tabVolumes:      Locator;
  readonly tabEmulation:    Locator;

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
    this.vmType = page.locator('[data-test="vmType"]');
    this.qemu = page.locator('[data-test="QEMU"]');
    this.vz = page.locator('[data-test="VZ"]');
    this.useRosetta = page.locator('[data-test="useRosetta"]');
    this.tabHardware = page.getByTestId('hardware');
    this.tabVolumes = page.getByTestId('volumes');
    this.tabEmulation = page.getByTestId('emulation');
  }
}
