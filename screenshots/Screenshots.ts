import childProcess from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import util from 'util';

import { expect } from '@playwright/test';

import { NavPage } from '../e2e/pages/nav-page';
import { PreferencesPage } from '../e2e/pages/preferences';

import type { Page } from '@playwright/test';

interface ScreenshotsOptions {
  directory: string;
  isOsCommand?: boolean;
}

export class Screenshots {
  private isOsCommand = true;

  // used by Mac api
  private appBundleTitle = 'Electron';

  protected windowTitle = '';
  private static screenshotIndex = 0;
  readonly page: Page;
  readonly directory: string;

  constructor(page: Page, opt: ScreenshotsOptions) {
    this.page = page;
    const { directory } = opt;

    this.directory = path.resolve(__dirname, 'output', os.platform(), directory);
    if (typeof (opt?.isOsCommand) !== 'undefined' ) {
      this.isOsCommand = opt.isOsCommand;
    }
  }

  protected buildPath(title: string): string {
    return path.resolve(this.directory, `${ Screenshots.screenshotIndex++ }_${ title }.png`);
  }

  protected async createScreenshotsDirectory() {
    if (!this.directory) {
      return;
    }

    await fs.promises.mkdir(
      this.directory,
      { recursive: true },
    );
  }

  protected osCommand(file: string): string {
    if (os.platform() === 'darwin') {
      return `screencapture -o -l $(GetWindowID  "${ this.appBundleTitle }" "${ this.windowTitle }") ${ file }`;
    }
    if (os.platform() === 'win32') {
      const script = path.resolve(__dirname, 'screenshot.ps1');

      return `powershell.exe ${ script } ${ file }`;
    }

    return `gnome-screenshot -w -f ${ file }`;
  }

  protected async screenshot(title: string) {
    const options = {
      fullPage: true,
      path:     this.buildPath(title),
    };

    if (!this.isOsCommand) {
      await this.page.screenshot(options);

      return;
    }

    const command = this.osCommand(options.path);

    try {
      await util.promisify(childProcess.exec)(command);
    } catch (e) {
      console.error(`Error, command failed: ${ command }`, { error: e });
      process.exit(1);
    }
  }
}

export class MainWindowScreenshots extends Screenshots {
  constructor(page: Page, opt: ScreenshotsOptions) {
    super(page, opt);
    this.windowTitle = 'Rancher Desktop';
  }

  async take(tabName: Parameters<NavPage['navigateTo']>[0], navPage?: NavPage, timeout?: number): Promise<void>;
  async take(screenshotName: string): Promise<void>;
  async take(name: string, navPage?: NavPage, timeout = 200) {
    if (navPage) {
      await navPage.navigateTo(name as Parameters<NavPage['navigateTo']>[0]);
      await this.page.waitForTimeout(timeout);
    }

    await this.createScreenshotsDirectory();
    await this.screenshot(name);
  }
}

export class PreferencesScreenshots extends Screenshots {
  readonly preferencePage: PreferencesPage;

  constructor(page: Page, preferencePage: PreferencesPage, opt: ScreenshotsOptions) {
    super(page, opt);
    this.preferencePage = preferencePage;
    this.windowTitle = 'Rancher Desktop - Preferences';
  }

  async take(tabName: string, subTabName?: string) {
    const tab = (this.preferencePage as any)[tabName];

    await tab.nav.click();
    await expect(tab.nav).toHaveClass('preferences-nav-item active');
    const path = subTabName ? `${ tabName }_${ subTabName }` : tabName;

    await this.createScreenshotsDirectory();
    await this.screenshot(path);
  }
}
