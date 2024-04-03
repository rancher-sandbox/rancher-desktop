import fs from 'fs';
import os from 'os';
import path from 'path';

import { expect } from '@playwright/test';

import { NavPage } from '../e2e/pages/nav-page';
import { PreferencesPage } from '../e2e/pages/preferences';

import { spawnFile } from '@pkg/utils/childProcess';
import { Log } from '@pkg/utils/logging';

import type { Page } from '@playwright/test';

interface ScreenshotsOptions {
  directory: string;
  log: Log;
}

export class Screenshots {
  // used by Mac api
  private appBundleTitle = 'Electron';

  protected windowTitle = '';
  private static screenshotIndex = 0;
  readonly page: Page;
  readonly directory: string;
  readonly log: Log;

  constructor(page: Page, opt: ScreenshotsOptions) {
    this.page = page;
    const { directory, log } = opt;

    this.directory = path.resolve(__dirname, 'output', os.platform(), directory);
    this.log = log;
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

  protected async screenshot(title: string) {
    const outPath = this.buildPath(title);

    try {
      switch (process.platform) {
      case 'darwin':
        await this.screenshotDarwin(outPath);
        break;
      case 'win32':
        await this.screenshotWindows(outPath);
        break;
      default:
        await this.screenshotLinux(outPath);
      }
    } catch (e) {
      console.error('Failed to take screenshot', { error: e });
      process.exit(1);
    }
  }

  protected async screenshotDarwin(outPath: string) {
    const { stdout: windowId, stderr } = await spawnFile('GetWindowID', [this.appBundleTitle, this.windowTitle], { stdio: 'pipe' });

    if (!windowId) {
      throw new Error(`Failed to find window ID for ${ this.windowTitle }: ${ stderr || '(no stderr)' }`);
    }
    await spawnFile('screencapture', ['-o', '-l', windowId.trim(), outPath], { stdio: this.log });
  }

  protected async screenshotWindows(outPath: string) {
    const script = path.resolve(__dirname, 'screenshot.ps1');

    await spawnFile('powershell.exe', [script, '-FilePath', outPath, '-Title', `'${ this.windowTitle }'`], { stdio: this.log });
  }

  protected async screenshotLinux(outPath: string) {
    // Find the target window; note that this is a child window of the window
    // frame, so we can't use it directly.
    let windowId = '';
    let { stdout } = await spawnFile('xwininfo', ['-name', this.windowTitle, '-tree'], { stdio: 'pipe' });

    // Walk up the parents of the current window, until the parent is the root window.
    while (true) {
      this.log.log(stdout);
      ([, windowId] = /xwininfo: Window id: (0x[0-9a-f]+)/i.exec(stdout) ?? []);
      const [, parentId, rest] = /Parent window id: (0x[0-9a-f]+)(.*)/i.exec(stdout) ?? [];

      if (!parentId || rest.includes('(the root window)')) {
        break;
      }
      ({ stdout } = await spawnFile('xwininfo', ['-id', parentId, '-tree'], { stdio: 'pipe' }));
    }
    if (!windowId) {
      throw new Error(`Failed to find window ID for ${ this.windowTitle }`);
    }
    await spawnFile('import', ['-window', windowId, outPath], { stdio: this.log });
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
