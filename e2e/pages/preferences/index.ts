import { ApplicationNav } from './application';
import { ContainerEngineNav } from './containerEngine';
import { KubernetesNav } from './kubernetes';
import { VirtualMachineNav } from './virtualMachine';
import { WslNav } from './wsl';

import type { Page } from '@playwright/test';

export class PreferencesPage {
  readonly page:            Page;
  readonly application:     ApplicationNav;
  readonly virtualMachine:  VirtualMachineNav;
  readonly containerEngine: ContainerEngineNav;
  readonly kubernetes:      KubernetesNav;
  readonly wsl:             WslNav;

  constructor(page: Page) {
    this.page = page;
    this.application = new ApplicationNav(page);
    this.virtualMachine = new VirtualMachineNav(page);
    this.containerEngine = new ContainerEngineNav(page);
    this.kubernetes = new KubernetesNav(page);
    this.wsl = new WslNav(page);
  }
}
