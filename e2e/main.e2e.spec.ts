import { test, expect, _electron } from '@playwright/test';

import { NavPage } from './pages/nav-page';
import { createDefaultSettings, startRancherDesktop, teardown } from './utils/TestUtils';

import type { ElectronApplication, Page } from '@playwright/test';

let page: Page;

/**
 * Using test.describe.serial make the test execute step by step, as described on each `test()` order
 * Playwright executes test in parallel by default and it will not work for our app backend loading process.
 * */
test.describe.serial('Main App Test', () => {
  let electronApp: ElectronApplication;

  test.beforeAll(async({ colorScheme }, testInfo) => {
    createDefaultSettings();

    electronApp = await startRancherDesktop(testInfo);
    page = await electronApp.firstWindow();
  });

  test.afterAll(({ colorScheme }, testInfo) => teardown(electronApp, testInfo));

  test('should start loading the background services and hide progress bar', async() => {
    const navPage = new NavPage(page);

    await navPage.progressBecomesReady();
    await expect(navPage.progressBar).toBeHidden();
  });

  test('should land on General page', async() => {
    const navPage = new NavPage(page);

    await expect(navPage.mainTitle).toHaveText('Welcome to Rancher Desktop by SUSE');
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
