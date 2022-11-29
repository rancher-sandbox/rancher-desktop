import os from 'os';

import { expect } from '@playwright/test';
import { Page, PageScreenshotOptions } from 'playwright';

import { NavPage } from '../e2e/pages/nav-page';
import { PreferencesPage } from '../e2e/pages/preferences';

interface ScreenshotsOptions {
  directory?: string;
}

export class Screenshots {
  private screenshotIndex = 0;
  readonly page: Page;
  readonly directory: string | undefined;

  constructor(page: Page, opt?: ScreenshotsOptions) {
    this.page = page;
    if (opt?.directory) {
      const { directory } = opt;

      this.directory = directory === undefined || directory === null ? '' : `${ directory }/`;
    }
  }

  protected setPath(title: string, opt: PageScreenshotOptions = {}) {
    return {
      ...opt,
      path: `screenshots/output/${ os.platform() }/${ this.directory }${ this.screenshotIndex++ }_${ title }.png`,
    };
  }

  protected async screenshot(path: string) {
    await this.page.screenshot(this.setPath(path, { fullPage: true }));
  }
}

export class MainWindowScreenshots extends Screenshots {
  async take(tabName: string, navPage?: NavPage, timeout = 200) {
    if (navPage) {
      await navPage.navigateTo(tabName as any);
      await this.page.waitForTimeout(timeout);
    }
    await this.screenshot(tabName);
  }
}

export class PreferencesScreenshots extends Screenshots {
  readonly preferencePage: PreferencesPage;

  constructor(page: Page, preferencePage: PreferencesPage, opt?: ScreenshotsOptions) {
    super(page, opt);
    this.preferencePage = preferencePage;
  }

  async take(tabName: string, subTabName?: string) {
    const tab = (this.preferencePage as any)[tabName];

    tab.nav.click();
    await expect(tab.nav).toHaveClass('preferences-nav-item active');
    const path = subTabName ? `${ tabName }_${ subTabName }` : tabName;

    await this.screenshot(path);
  }
}
