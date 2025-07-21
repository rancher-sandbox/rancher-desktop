import type { Page, Locator } from '@playwright/test';
export class ApplicationNav {
  readonly page:                     Page;
  readonly nav:                      Locator;
  readonly tabBehavior:              Locator;
  readonly tabEnvironment:           Locator;
  readonly tabGeneral:               Locator;
  readonly administrativeAccess:     Locator;
  readonly automaticUpdates:         Locator;
  readonly automaticUpdatesCheckbox: Locator;
  readonly statistics:               Locator;
  readonly autoStart:                Locator;
  readonly background:               Locator;
  readonly notificationIcon:         Locator;
  readonly pathManagement:           Locator;

  constructor(page: Page) {
    this.page = page;
    this.nav = page.locator('[data-test="nav-application"]');
    this.tabBehavior = page.locator('.tab >> text=Behavior');
    this.tabEnvironment = page.locator('.tab >> text=Environment');
    this.tabGeneral = page.locator('.tab >> text=General');
    this.administrativeAccess = page.locator('[data-test="administrativeAccess"]');
    this.automaticUpdates = page.locator('[data-test="automaticUpdates"]');
    this.automaticUpdatesCheckbox = page.locator('[data-test="automaticUpdatesCheckbox"]');
    this.statistics = page.locator('[data-test="statistics"]');
    this.autoStart = page.locator('[data-test="autoStart"]');
    this.background = page.locator('[data-test="background"]');
    this.notificationIcon = page.locator('[data-test="notificationIcon"]');
    this.pathManagement = page.locator('[data-test="pathManagement"]');
  }
}
