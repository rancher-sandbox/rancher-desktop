import os from 'os';
import path from 'path';
import {
  ElectronApplication, BrowserContext, _electron, Page, Locator
} from 'playwright';
import { test } from '@playwright/test';
import { createDefaultSettings, playwrightReportAssets } from './utils/TestUtils';
import { NavPage } from './pages/nav-page';
import { K8sPage } from './pages/k8s-page';
import { WslPage } from './pages/wsl-page';
import { PortForwardPage } from './pages/portforward-page';

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

    await navPage.getGeneralPageTile('Welcome to Rancher Desktop');
  });

  test('should start loading the background services and hide progress bar', async() => {
    const navPage = new NavPage(page);

    await navPage.getProgressBar();
  });

  test('should navigate to Kubernetes Settings and check elements', async() => {
    const navPage = new NavPage(page);
    const k8sPage = new K8sPage(page);

    await navPage.navigateTo('K8s');

    if (!os.platform().startsWith('win')) {
      await k8sPage.getK8sMemorySlider();
      await k8sPage.getK8sCpuSlider();
    }

    await navPage.getGeneralPageTile('Kubernetes Settings');
    await k8sPage.getK8sPort();
    await k8sPage.getK8sResetButton();
  });

  /**
   * Checking WSL and Port Forwarding - Windows Only
   */
  if (os.platform().startsWith('win')) {
    test('should navigate to WSL Integration and check elements', async() => {
      const navPage = new NavPage(page);
      const wslPage = new WslPage(page);

      await navPage.navigateTo('Integrations');

      await navPage.getGeneralPageTile('WSL Integration');
      await wslPage.getWslDescription();
    });

    test('should navigate to Port Forwarding and check elements', async() => {
      const navPage = new NavPage(page);
      const portForwardPage = new PortForwardPage(page);

      await navPage.navigateTo('PortForwarding');
      await navPage.getGeneralPageTile('Port Forwarding');
      await portForwardPage.getPortForwardDescription();
    });
  }

  /**
   * Checking Support Utilities symlink list - macOS/Linux Only
   */
  if (!os.platform().startsWith('win')) {
    test('should navigate to Supporting Utilities and check elements', async() => {
      const navPage = new NavPage(page);

      await navPage.navigateTo('Integrations');
      await navPage.getGeneralPageTile('Supporting Utilities');
    });
  }

  test('should navigate to Images page', async() => {
    const navPage = new NavPage(page);

    await navPage.navigateTo('Images');
    await navPage.getGeneralPageTile('Images');
  });

  test('should navigate to Troubleshooting and check elements', async() => {
    const navPage = new NavPage(page);

    await navPage.navigateTo('Troubleshooting');
    await navPage.getGeneralPageTile('Troubleshooting');
  });
});
