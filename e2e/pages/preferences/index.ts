import { Page } from 'playwright';
import { ApplicationNav } from './application';
import { ContainerRuntimeNav } from './containerRuntime';
import { KubernetesNav } from './kubernetes';
import { VirtualMachineNav } from './virtualMachine';
import { WslNav } from './wsl';

export class PreferencesPage {
  readonly page: Page;
  readonly application: ApplicationNav;
  readonly virtualMachine: VirtualMachineNav;
  readonly containerRuntime: ContainerRuntimeNav;
  readonly kubernetes: KubernetesNav;
  readonly wsl: WslNav;

  constructor(page: Page) {
    this.page = page;
    this.application = new ApplicationNav(page);
    this.virtualMachine = new VirtualMachineNav(page);
    this.containerRuntime = new ContainerRuntimeNav(page);
    this.kubernetes = new KubernetesNav(page);
    this.wsl = new WslNav(page);
  }
}
