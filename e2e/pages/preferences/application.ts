import { Page, Locator } from 'playwright';
export class ApplicationNav {
  readonly page: Page;
  readonly nav: Locator;
  readonly tabBehavior: Locator;
  readonly tabEnvironment: Locator;
  readonly administrativeAccess: Locator;
  readonly automaticUpdates: Locator;
  readonly automaticUpdatesCheckbox: Locator;
  readonly statistics: Locator;
  readonly pathManagement: Locator;

  constructor(page: Page) {
    this.page = page;
    this.nav = page.locator('[data-test="nav-application"]');
    this.tabBehavior = page.locator('.tab >> text=Behavior');
    this.tabEnvironment = page.locator('.tab >> text=Environment');
    this.administrativeAccess = page.locator('[data-test="administrativeAccess"]');
    this.automaticUpdates = page.locator('[data-test="automaticUpdates"]');
    this.automaticUpdatesCheckbox = page.locator('[data-test="automaticUpdatesCheckbox"]');
    this.statistics = page.locator('[data-test="statistics"]');
    this.pathManagement = page.locator('[data-test="pathManagement"]');
  }
}
