import os from 'os';
import path from 'path';
import { ElectronApplication, BrowserContext, _electron, Page } from 'playwright';
import { test, expect } from '@playwright/test';
import { createDefaultSettings, playwrightReportAssets } from './utils/TestUtils';
import { NavPage } from './pages/nav-page';

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
        '--disable-dev-shm-usage',
      ]
    });
    context = electronApp.context();

    await context.tracing.start({ screenshots: true, snapshots: true });
    page = await electronApp.firstWindow();
  });

  test.afterAll(async() => {
    await context.tracing.stop({ path: playwrightReportAssets(path.basename(__filename)) });
    await electronApp.close();
  });

  test('should land on General page', async() => {
    const navPage = new NavPage(page);

    await expect(navPage.mainTitle).toHaveText('Welcome to Rancher Desktop');
  });

  test('should start loading the background services and hide progress bar', async() => {
    const navPage = new NavPage(page);

    await navPage.progressBecomesReady();
    await expect(navPage.progressBar).toBeHidden();
  });

  test('should navigate to Kubernetes Settings and check elements', async() => {
    const navPage = new NavPage(page);
    const k8sPage = await navPage.navigateTo('K8s');

    if (!os.platform().startsWith('win')) {
      await expect(k8sPage.memorySlider).toBeVisible();
      await expect(k8sPage.cpuSlider).toBeVisible();
    } else {
      // On Windows memory slider and cpu should be hidden
      await expect(k8sPage.memorySlider).toBeHidden();
      await expect(k8sPage.memorySlider).toBeHidden();
    }

    await expect(navPage.mainTitle).toHaveText('Kubernetes Settings');
    await expect(k8sPage.port).toBeVisible();
    await expect(k8sPage.resetButton).toBeVisible();
    await expect(k8sPage.engineRuntime).toBeVisible();
  });

  /**
   * Checking WSL and Port Forwarding - Windows Only
   */
  if (os.platform().startsWith('win')) {
    test('should navigate to WSL Integration and check elements', async() => {
      const navPage = new NavPage(page);
      const wslPage = await navPage.navigateTo('Integrations');

      await expect(navPage.mainTitle).toHaveText('WSL Integration');
      await expect(wslPage.description).toBeVisible();
    });

    test('should navigate to Port Forwarding and check elements', async() => {
      const navPage = new NavPage(page);
      const portForwardPage = await navPage.navigateTo('PortForwarding');

      await expect(navPage.mainTitle).toHaveText('Port Forwarding');
      await expect(portForwardPage.content).toBeVisible();
      await expect(portForwardPage.table).toBeVisible();
      await expect(portForwardPage.fixedHeader).toBeVisible();
    });
  }

  /**
   * Checking Support Utilities symlink list - macOS/Linux Only
   */
  if (!os.platform().startsWith('win')) {
    test('should navigate to Supporting Utilities and check elements', async() => {
      const navPage = new NavPage(page);
      const integrationsPage = await navPage.navigateTo('Integrations');

      await expect(navPage.mainTitle).toHaveText('Supporting Utilities');
      await expect(integrationsPage.description).toBeVisible();
    });
  }

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
    await expect(troubleshootingPage.dashboard).toBeVisible();
    await expect(troubleshootingPage.logsButton).toBeVisible();
    await expect(troubleshootingPage.factoryResetButton).toBeVisible();
  });
});
