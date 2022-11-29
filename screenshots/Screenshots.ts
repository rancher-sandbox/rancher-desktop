import childProcess from 'child_process';
import os from 'os';

import { expect } from '@playwright/test';

import { NavPage } from '../e2e/pages/nav-page';
import { PreferencesPage } from '../e2e/pages/preferences';

import type { Page, PageScreenshotOptions } from '@playwright/test';

interface ScreenshotsOptions {
  directory?: string;
  isOsCommand?: boolean;
}

export class Screenshots {
  private isOsCommand = true;

  // used by Mac api
  private appBundleTitle = 'Rancher Desktop';

  protected windowTitle = '';
  private screenshotIndex = 0;
  readonly page: Page;
  readonly directory: string | undefined;

  constructor(page: Page, opt?: ScreenshotsOptions) {
    this.page = page;
    if (opt?.directory) {
      const { directory } = opt;

      this.directory = directory === undefined || directory === null ? '' : `${ directory }/`;
    }
    if (opt?.isOsCommand) {
      this.isOsCommand = opt.isOsCommand;
    }
  }

  protected buildPath(title: string): string {
    return `screenshots/output/${ os.platform() }/${ this.directory }${ this.screenshotIndex++ }_${ title }.png`;
  }

  protected osCommand(path: string): string {
    if (os.platform() === 'darwin') {
      return `screencapture -l $(GetWindowID  "${ this.appBundleTitle }" "${ this.windowTitle }") ${ path }`;
    }
    if (os.platform() === 'win32') {
      return `import -window root ${ path }`;
    }

    return `gnome-screenshot -w -f ${ path }`;
  }

  protected async screenshot(title: string) {
    const options = {
      fullPage: true,
      path:     this.buildPath(title),
    };

    await this.page.screenshot(options);

    if (this.isOsCommand) {
      const command = this.osCommand(options.path);

      try {
        childProcess.execSync(command);
      } catch (e) {
        console.error(`Error, command failed: ${ command }`);
        process.exit(1);
      }
    }
  }
}

export class MainWindowScreenshots extends Screenshots {
  constructor(page: Page, opt?: ScreenshotsOptions) {
    super(page, opt);
    this.windowTitle = 'Rancher Desktop';
  }

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
    this.windowTitle = 'Rancher Desktop - Preferences';
  }

  async take(tabName: string, subTabName?: string) {
    const tab = (this.preferencePage as any)[tabName];

    tab.nav.click();
    await expect(tab.nav).toHaveClass('preferences-nav-item active');
    const path = subTabName ? `${ tabName }_${ subTabName }` : tabName;

    await this.screenshot(path);
  }
}
