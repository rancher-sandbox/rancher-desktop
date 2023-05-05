import path from 'path';

import { test, expect, _electron } from '@playwright/test';

import { NavPage } from './pages/nav-page';
import { createDefaultSettings, reportAsset, teardown } from './utils/TestUtils';

import type { ElectronApplication, BrowserContext, Page } from '@playwright/test';

let page: Page;

/**
 * Using test.describe.serial make the test execute step by step, as described on each `test()` order
 * Playwright executes test in parallel by default and it will not work for our app backend loading process.
 * */
test.describe.serial('Main App Test', () => {
  let electronApp: ElectronApplication;
  let context: BrowserContext;

  test.beforeAll(async() => {
    createDefaultSettings();

    electronApp = await _electron.launch({
      args: [
        path.join(__dirname, '../'),
        '--disable-gpu',
        '--whitelisted-ips=',
        // See pkg/rancher-desktop/utils/commandLine.ts before changing the next item as the final option.
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
  });

  test.afterAll(() => teardown(electronApp, __filename));

  test('should start loading the background services and hide progress bar', async() => {
    const navPage = new NavPage(page);

    await navPage.progressBecomesReady();
    await expect(navPage.progressBar).toBeHidden();
  });

  test('should land on General page', async() => {
    const navPage = new NavPage(page);

    await expect(navPage.mainTitle).toHaveText('Welcome to Rancher Desktop');
  });

  test('should navigate to Port Forwarding and check elements', async() => {
    const navPage = new NavPage(page);
    const portForwardPage = await navPage.navigateTo('PortForwarding');

    await expect(navPage.mainTitle).toHaveText('Port Forwarding');
    await expect(portForwardPage.content).toBeVisible();
    await expect(portForwardPage.table).toBeVisible();
    await expect(portForwardPage.fixedHeader).toBeVisible();
  });

  test('should navigate to Images page', async() => {
    const navPage = new NavPage(page);
    const imagesPage = await navPage.navigateTo('Images');

    await expect(navPage.mainTitle).toHaveText('Images');
    await expect(imagesPage.table).toBeVisible();
  });

  test('should navigate to Troubleshooting and check elements', async() => {
    const navPage = new NavPage(page);
    const troubleshootingPage = await navPage.navigateTo('Troubleshooting');

    await expect(navPage.mainTitle).toHaveText('Troubleshooting');
    await expect(troubleshootingPage.troubleshooting).toBeVisible();
    await expect(troubleshootingPage.logsButton).toBeVisible();
    await expect(troubleshootingPage.factoryResetButton).toBeVisible();
  });
});
