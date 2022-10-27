import os from 'os';
import path from 'path';

import { test, expect } from '@playwright/test';
import { ElectronApplication, BrowserContext, _electron, Page } from 'playwright';

import { NavPage } from './pages/nav-page';
import { PreferencesPage } from './pages/preferences';
import { createDefaultSettings, packageLogs, reportAsset } from './utils/TestUtils';

let page: Page;

/**
 * Using test.describe.serial make the test execute step by step, as described on each `test()` order
 * Playwright executes test in parallel by default and it will not work for our app backend loading process.
 * */
test.describe.serial('Main App Test', () => {
  let electronApp: ElectronApplication;
  let context: BrowserContext;
  let preferencesWindow: Page;

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
        RD_LOGS_DIR:     reportAsset(__filename, 'log'),
        RD_MOCK_BACKEND: '1',
      },
    });
    context = electronApp.context();

    await context.tracing.start({ screenshots: true, snapshots: true });
    page = await electronApp.firstWindow();

    await new NavPage(page).preferencesButton.click();

    preferencesWindow = await electronApp.waitForEvent('window', page => /preferences/i.test(page.url()));
  });

  test.afterAll(async() => {
    await context.tracing.stop({ path: reportAsset(__filename) });
    await packageLogs(__filename);
    await electronApp.close();
  });

  test('should open preferences modal', () => {
    expect(preferencesWindow).toBeDefined();
  });

  test('should show application page', async() => {
    const { application } = new PreferencesPage(preferencesWindow);

    await expect(application.nav).toHaveClass('preferences-nav-item active');

    if (!os.platform().startsWith('win')) {
      await expect(application.tabBehavior).toHaveText('Behavior');
      await expect(application.administrativeAccess).toBeVisible();
    } else {
      await expect(application.tabBehavior).not.toBeVisible();
      await expect(application.tabEnvironment).not.toBeVisible();
    }

    await expect(application.automaticUpdates).toBeVisible();
    await expect(application.statistics).toBeVisible();
    await expect(application.pathManagement).not.toBeVisible();
  });

  test('should render environment tab', async() => {
    test.skip(os.platform() === 'win32', 'Environment tab not available on Windows');
    const { application } = new PreferencesPage(preferencesWindow);

    await application.tabEnvironment.click();

    await expect(application.administrativeAccess).not.toBeVisible();
    await expect(application.automaticUpdates).not.toBeVisible();
    await expect(application.statistics).not.toBeVisible();
    await expect(application.pathManagement).toBeVisible();
  });

  test('should render environment tab after close and reopen preferences modal', async() => {
    test.skip(os.platform() === 'win32', 'Environment tab not available on Windows');
    preferencesWindow.close();

    await new NavPage(page).preferencesButton.click();
    preferencesWindow = await electronApp.waitForEvent('window', page => /preferences/i.test(page.url()));

    expect(preferencesWindow).toBeDefined();

    const { application } = new PreferencesPage(preferencesWindow);

    await expect(application.nav).toHaveClass('preferences-nav-item active');
    await expect(application.tabBehavior).toBeVisible();
    await expect(application.tabEnvironment).toBeVisible();
    await expect(application.administrativeAccess).not.toBeVisible();
    await expect(application.automaticUpdates).not.toBeVisible();
    await expect(application.statistics).not.toBeVisible();
    await expect(application.pathManagement).toBeVisible();
  });

  test('should navigate to virtual machine', async() => {
    test.skip(os.platform() === 'win32', 'Virtual Machine not available on Windows');
    const { virtualMachine, application } = new PreferencesPage(preferencesWindow);

    await virtualMachine.nav.click();

    await expect(application.nav).toHaveClass('preferences-nav-item');
    await expect(virtualMachine.nav).toHaveClass('preferences-nav-item active');
    await expect(virtualMachine.memory).toBeVisible();
    await expect(virtualMachine.cpus).toBeVisible();
  });

  test('should navigate to container engine', async() => {
    const { containerEngine } = new PreferencesPage(preferencesWindow);

    await containerEngine.nav.click();

    await expect(containerEngine.nav).toHaveClass('preferences-nav-item active');
    await expect(containerEngine.containerEngine).toBeVisible();
  });

  test('should render container engine tab after close and reopen preferences modal', async() => {
    preferencesWindow.close();

    await new NavPage(page).preferencesButton.click();
    preferencesWindow = await electronApp.waitForEvent('window', page => /preferences/i.test(page.url()));

    expect(preferencesWindow).toBeDefined();
    const { containerEngine } = new PreferencesPage(preferencesWindow);

    await expect(containerEngine.nav).toHaveClass('preferences-nav-item active');
    await expect(containerEngine.containerEngine).toBeVisible();
  });

  test('should navigate to kubernetes', async() => {
    const { kubernetes, containerEngine } = new PreferencesPage(preferencesWindow);

    await kubernetes.nav.click();

    await expect(containerEngine.nav).toHaveClass('preferences-nav-item');
    await expect(kubernetes.nav).toHaveClass('preferences-nav-item active');
    await expect(kubernetes.kubernetesToggle).toBeVisible();
    await expect(kubernetes.kubernetesVersion).toBeVisible();
    await expect(kubernetes.kubernetesPort).toBeVisible();
    await expect(kubernetes.traefikToggle).toBeVisible();
  });

  test('should navigate to WSL Integrations and check elements', async() => {
    test.skip(os.platform() !== 'win32', 'WSL Integrations not available on macOS & Linux');
    const { wsl } = new PreferencesPage(preferencesWindow);

    await wsl.nav.click();

    await expect(wsl.nav).toHaveClass('preferences-nav-item active');
  });

  test('should not render WSL Integrations on macOS and Linux', async() => {
    test.skip(os.platform() === 'win32', 'WSL Integrations is only available on Windows');
    const { wsl } = new PreferencesPage(preferencesWindow);

    await expect(wsl.nav).not.toBeVisible();
  });
});
