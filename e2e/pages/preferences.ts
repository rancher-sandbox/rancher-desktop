import { Page, Locator } from 'playwright';
export class PreferencesPage {
  readonly page: Page;
  readonly applicationNav: Locator;
  readonly navVirtualMachine: Locator;
  readonly navContainerRuntime: Locator;
  readonly navKubernetes: Locator;
  readonly behaviorTab: Locator;
  readonly environmentTab: Locator;
  readonly administrativeAccess: Locator;
  readonly automaticUpdates: Locator;
  readonly statistics: Locator;
  readonly pathManagement: Locator;
  readonly memory: Locator;
  readonly cpus: Locator;
  readonly containerRuntime: Locator;

  constructor(page: Page) {
    this.page = page;
    this.applicationNav = page.locator('[data-test="navApplication"]');
    this.navVirtualMachine = page.locator('[data-test="navVirtual Machine"]');
    this.navContainerRuntime = page.locator('[data-test="navContainer Runtime"]');
    this.navKubernetes = page.locator('[data-test="navKubernetes"]');
    this.behaviorTab = page.locator('.tab >> text=Behavior');
    this.environmentTab = page.locator('.tab >> text=Environment');
    this.administrativeAccess = page.locator('[data-test="administrativeAccess"]');
    this.automaticUpdates = page.locator('[data-test="automaticUpdates"]');
    this.statistics = page.locator('[data-test="statistics"]');
    this.pathManagement = page.locator('[data-test="pathManagement"]');
    this.memory = page.locator('#memoryInGBWrapper');
    this.cpus = page.locator('#numCPUWrapper');
    this.containerRuntime = page.locator('[data-test="containerRuntime"]');
  }
}
