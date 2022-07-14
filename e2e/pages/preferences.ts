import { Page, Locator } from 'playwright';
export class PreferencesPage {
  readonly page: Page;
  readonly applicationNav: Locator;
  readonly behaviorTab: Locator;
  readonly environmentTab: Locator;
  readonly administrativeAccess: Locator;
  readonly automaticUpdates: Locator;
  readonly statistics: Locator;
  readonly pathManagement: Locator;

  constructor(page: Page) {
    this.page = page;
    this.applicationNav = page.locator('[data-test="navApplication"]');
    this.behaviorTab = page.locator('.tab >> text=Behavior');
    this.environmentTab = page.locator('.tablist #environment');
    this.administrativeAccess = page.locator('[data-test="administrativeAccess"]');
    this.automaticUpdates = page.locator('[data-test="automaticUpdates"]');
    this.statistics = page.locator('[data-test="statistics"]');
    this.pathManagement = page.locator('[data-test="pathManagement"]');
  }
}
