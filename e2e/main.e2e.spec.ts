import os from 'os';
import path from 'path';
import {
  ElectronApplication, BrowserContext, _electron, Page, Locator
} from 'playwright';
import { test, expect } from '@playwright/test';
import { createDefaultSettings } from './utils/TestUtils';

let page: Page;
const defaultReportFolder = path.join(__dirname, 'reports/');

/**
 * Using test.describe.serial make the test execute step by step, as described on each `test()` order
 * Playwright executes test in parallel by default and it will not work for our app backend loading process.
 * */
test.describe.serial('Main App Test', () => {
  let mainTitle: Locator;
  let electronApp: ElectronApplication;
  let context: BrowserContext;
  const mainTitleSelector = '[data-test="mainTitle"]';

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
    await context.tracing.stop({ path: path.join(defaultReportFolder, 'pw-trace.zip') });
    await electronApp.close();
  });

  test('should land on General page', async() => {
    mainTitle = page.locator(mainTitleSelector);

    await expect(mainTitle).toHaveText('Welcome to Rancher Desktop');
  });

  test('should start loading the background services and hide progress bar', async() => {
    const progressBarSelector = page.locator('.progress');

    await progressBarSelector.waitFor({ state: 'detached', timeout: 120_000 });
    await expect(progressBarSelector).toBeHidden();
  });

  test('should navigate to Kubernetes Settings and check elements', async() => {
    const k8sMemorySliderSelector = '[id="memoryInGBWrapper"]';
    const k8sCpuSliderSelector = '[id="numCPUWrapper"]';
    const k8sPortSelector = '[data-test="portConfig"]';
    const k8sResetBtn = '[data-test="k8sResetBtn"]';

    await navigateTo('K8s');
    // Collecting data from selectors
    const k8sSettingsTitle = page.locator(mainTitleSelector);
    const k8sMemorySlider = page.locator(k8sMemorySliderSelector);
    const k8sCpuSlider = page.locator(k8sCpuSliderSelector);
    const k8sPort = page.locator(k8sPortSelector);
    const k8sResetButton = page.locator(k8sResetBtn);

    if (!os.platform().startsWith('win')) {
      await expect(k8sMemorySlider).toBeVisible();
      await expect(k8sCpuSlider).toBeVisible();
    }

    await expect(k8sSettingsTitle).toHaveText('Kubernetes Settings');
    await expect(k8sPort).toBeVisible();
    await expect(k8sResetButton).toBeVisible();
  });

  /**
   * Checking WSL and Port Forwarding - Windows Only
   */
  if (os.platform().startsWith('win')) {
    test('should navigate to WSL Integration and check elements', async() => {
      const wslDescriptionSelector = '.description';

      await navigateTo('Integrations');
      const getWslIntegrationTitle = page.locator(mainTitleSelector);
      const getWslDescriptionText = page.locator(wslDescriptionSelector);

      await expect(getWslIntegrationTitle).toHaveText('WSL Integration');
      await expect(getWslDescriptionText).toBeVisible();
    });

    test('should navigate to Port Forwarding and check elements', async() => {
      const portForwardingContentSelector = '.content';

      await navigateTo('PortForwarding');
      const getPortForwardingTitle = page.locator(mainTitleSelector);
      const getPortForwardingContent = page.locator(portForwardingContentSelector);

      await expect(getPortForwardingTitle).toHaveText('Port Forwarding');
      await expect(getPortForwardingContent).toBeVisible();
    });
  }

  /**
   * Checking Support Utilities symlink list - macOS/Linux Only
   */
  if (!os.platform().startsWith('win')) {
    test('should navigate to Supporting Utilities and check elements', async() => {
      await navigateTo('Integrations');
      const getSupportTitle = page.locator(mainTitleSelector);

      await expect(getSupportTitle).toHaveText('Supporting Utilities');
    });
  }

  test('should navigate to Images page', async() => {
    const getSupportTitle = page.locator(mainTitleSelector);

    await navigateTo('Images');
    await expect(getSupportTitle).toHaveText('Images');
  });

  test('should navigate to Troubleshooting and check elements', async() => {
    const getSupportTitle = page.locator(mainTitleSelector);

    await navigateTo('Troubleshooting');
    await expect(getSupportTitle).toHaveText('Troubleshooting');
  });
});

/**
 * Navigate to a specific tab
 * @param path
 */
async function navigateTo(path: string) {
  try {
    return await Promise.all([
      page.click(`.nav li[item="/${ path }"] a`),
      page.waitForNavigation({ url: `**/${ path }`, timeout: 60_000 }),
      page.screenshot({ path: `${ defaultReportFolder }${ path }-screenshot.png` })
    ]);
  } catch (err) {
    console.log(`Cannot navigate to ${ path }. Error ---> `, err);
  }
}
