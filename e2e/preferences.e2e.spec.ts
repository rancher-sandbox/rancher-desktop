import os from 'os';
import path from 'path';
import { ElectronApplication, BrowserContext, _electron, Page } from 'playwright';
import { test, expect } from '@playwright/test';
import { createDefaultSettings, packageLogs, reportAsset } from './utils/TestUtils';
import { NavPage } from './pages/nav-page';
import { PreferencesPage } from './pages/preferences';

let page: Page;

/**
 * Using test.describe.serial make the test execute step by step, as described on each `test()` order
 * Playwright executes test in parallel by default and it will not work for our app backend loading process.
 * */
test.describe.serial('Main App Test', () => {
  let electronApp: ElectronApplication;
  let context: BrowserContext;
  let preferencesWindow: Page | undefined;

  test.beforeAll(async() => {
    createDefaultSettings();

    electronApp = await _electron.launch({
      args: [
        path.join(__dirname, '../'),
        '--disable-gpu',
        '--whitelisted-ips=',
        // See src/utils/commandLine.ts before changing the next item as the final option.
        '--disable-dev-shm-usage',
        '--no-modal-dialogs',
      ],
      env: {
        ...process.env,
        RD_LOGS_DIR: reportAsset(__filename, 'log'),
      },
    });
    context = electronApp.context();

    await context.tracing.start({ screenshots: true, snapshots: true });
    page = await electronApp.firstWindow();

    new NavPage(page).preferencesButton.click();

    await electronApp.waitForEvent('window');
    await electronApp.waitForEvent('window');

    const windows = electronApp.windows();

    preferencesWindow = windows.find(w => w.url().includes('preferences'));
  });

  test.afterAll(async() => {
    await context.tracing.stop({ path: reportAsset(__filename) });
    await packageLogs(__filename);
    await electronApp.close();
  });

  test('should land application behavior tab', async() => {
    if (!preferencesWindow) {
      return;
    }

    const preferencesPage = new PreferencesPage(preferencesWindow);

    await expect(preferencesPage.applicationNav).toHaveClass('preferences-nav-item active');
    await expect(preferencesPage.behaviorTab).toHaveText('Behavior');
    await expect(preferencesPage.administrativeAccess).toBeVisible();
    await expect(preferencesPage.automaticUpdates).toBeVisible();
    await expect(preferencesPage.statistics).toBeVisible();
    await expect(preferencesPage.pathManagement).not.toBeVisible();
  });

  test('should render environment tab', async() => {
    if (!preferencesWindow) {
      return;
    }

    const preferencesPage = new PreferencesPage(preferencesWindow);

    preferencesPage.environmentTab.click();

    await expect(preferencesPage.administrativeAccess).not.toBeVisible();
    await expect(preferencesPage.automaticUpdates).not.toBeVisible();
    await expect(preferencesPage.statistics).not.toBeVisible();
    await expect(preferencesPage.pathManagement).toBeVisible();
  });

  test('should navigate to virtual machine', async() => {
    if (!preferencesWindow) {
      return;
    }

    const preferencesPage = new PreferencesPage(preferencesWindow);

    preferencesPage.navVirtualMachine.click();

    await expect(preferencesPage.applicationNav).toHaveClass('preferences-nav-item');
    await expect(preferencesPage.navVirtualMachine).toHaveClass('preferences-nav-item active');
    await expect(preferencesPage.memory).toBeVisible();
    await expect(preferencesPage.memory).toBeVisible();
  });

  test('should navigate to container runtime', async() => {
    if (!preferencesWindow) {
      return;
    }

    const preferencesPage = new PreferencesPage(preferencesWindow);

    preferencesPage.navContainerRuntime.click();

    await expect(preferencesPage.navVirtualMachine).toHaveClass('preferences-nav-item');
    await expect(preferencesPage.navContainerRuntime).toHaveClass('preferences-nav-item active');
    await expect(preferencesPage.containerRuntime).toBeVisible();
  });
});
