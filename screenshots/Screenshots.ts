import childProcess from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { expect } from '@playwright/test';
import dayjs from 'dayjs';

import { NavPage } from '../e2e/pages/nav-page';
import { PreferencesPage } from '../e2e/pages/preferences';

import type { Page } from '@playwright/test';

interface ScreenshotsOptions {
  directory?: string;
  isOsCommand?: boolean;
}

export class Screenshots {
  private isOsCommand = true;
  private sleepDuration = Number(process.env.RD_ENV_SCREENSHOT_SLEEP) || 1000;

  // used by Mac api
  private appBundleTitle = 'Electron';

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

  protected osCommand(file: string): string {
    if (os.platform() === 'darwin') {
      return `screencapture -l $(GetWindowID  "${ this.appBundleTitle }" "${ this.windowTitle }") ${ file }`;
    }
    if (os.platform() === 'win32') {
      return `${ path.resolve(process.cwd(), 'resources', 'ShareX', 'sharex') } -p -s -ActiveWindow`;
    }

    return `gnome-screenshot -w -f ${ file }`;
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

        if (os.platform() === 'win32') {
          // sleep to allow ShareX to write screenshot
          await (new Promise((resolve) => {
            setTimeout(resolve, this.sleepDuration);
          }));

          const screenshotsPath = path.resolve(process.cwd(), 'resources', 'ShareX', 'ShareX', 'Screenshots', `${ dayjs().format('YYYY-MM') }`);
          const screenshots = fs.readdirSync(screenshotsPath);

          fs.renameSync(
            path.resolve(screenshotsPath, screenshots?.[0]),
            this.buildPath(title),
          );
        }
      } catch (e) {
        console.error(`Error, command failed: ${ command }`, { error: e });
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
