import os from 'os';
import path from 'path';

import { test, expect, _electron } from '@playwright/test';

import { NavPage } from '../e2e/pages/nav-page';
import { PreferencesPage } from '../e2e/pages/preferences';
import { createDefaultSettings, reportAsset, teardown } from '../e2e/utils/TestUtils';
import { MainWindowScreenshots, PreferencesScreenshots } from './Screenshots';

import type { ElectronApplication, BrowserContext, Page } from '@playwright/test';

const isWin = os.platform() === 'win32';

test.describe.serial('Main App Test', () => {
  let electronApp: ElectronApplication;
  let context: BrowserContext;
  let page: Page;
  let navPage: NavPage;

  test.beforeAll(async({ colorScheme }) => {
    createDefaultSettings({
      application:     { updater: { enabled: true } },
      containerEngine: { allowedImages: { enabled: true, patterns: ['rancher/example'] } },
      diagnostics:     { showMuted: true, mutedChecks: { MOCK_CHECKER: true } },
    });

    electronApp = await _electron.launch({
      args: [
        path.join(__dirname, '../'),
        '--disable-gpu',
        '--whitelisted-ips=',
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
    navPage = new NavPage(page);

    await page.emulateMedia({ colorScheme });

    await navPage.progressBecomesReady();
  });

  test.afterAll(() => teardown(electronApp, __filename));

  test('Main Page', async({ colorScheme }) => {
    const screenshot = new MainWindowScreenshots(page, { directory: `${ colorScheme }/main` });

    await screenshot.take('General');
    await screenshot.take('PortForwarding', navPage);

    const imagesPage = await navPage.navigateTo('Images');

    await expect(imagesPage.rows).toBeVisible();
    await screenshot.take('Images');

    await screenshot.take('Troubleshooting', navPage);

    const diagnosticsPage = await navPage.navigateTo('Diagnostics');

    // show diagnostics badge
    await expect(diagnosticsPage.diagnostics).toBeVisible();
    await diagnosticsPage.checkerRows('MOCK_CHECKER').muteButton.click();
    // wait for the red bullet to appear on the Diagnostics page label
    await page.waitForTimeout(1000);

    await screenshot.take('Diagnostics');

    const extensionsPage = await navPage.navigateTo('Extensions');

    await expect(extensionsPage.cardEpinio).toBeVisible();
    await screenshot.take('Extensions');

    await extensionsPage.tabInstalled.click();

    await screenshot.take('Extensions-Installed');

    await extensionsPage.tabCatalog.click();

    await extensionsPage.cardEpinio.click();

    await screenshot.take('Extensions-Details');
  });

  test('Preferences Page', async({ colorScheme }) => {
    await navPage.preferencesButton.click();

    await electronApp.waitForEvent('window', page => /preferences/i.test(page.url()));

    // gets full content of preferences window
    const preferencesPage = electronApp.windows()[1];

    await preferencesPage.emulateMedia({ colorScheme });

    const e2ePreferences = new PreferencesPage(preferencesPage);
    const screenshot = new PreferencesScreenshots(preferencesPage, e2ePreferences, { directory: `${ colorScheme }/preferences` });

    // enable Apply button
    await e2ePreferences.application.automaticUpdatesCheckbox.click();
    await preferencesPage.waitForTimeout(200);

    await screenshot.take('application', 'tabGeneral');

    await e2ePreferences.application.nav.click();
    await e2ePreferences.application.tabBehavior.click();
    await expect(e2ePreferences.application.autoStart).toBeVisible();
    await screenshot.take('application', 'tabBehavior');

    if (!isWin) {
      await e2ePreferences.application.nav.click();
      await e2ePreferences.application.tabEnvironment.click();
      await expect(e2ePreferences.application.pathManagement).toBeVisible();
      await screenshot.take('application', 'tabEnvironment');

      await screenshot.take('virtualMachine');
    }

    await screenshot.take('containerEngine', 'tabGeneral');

    await e2ePreferences.containerEngine.nav.click();
    await e2ePreferences.containerEngine.tabAllowedImages.click();
    await expect(e2ePreferences.containerEngine.allowedImages).toBeVisible();
    await screenshot.take('containerEngine', 'tabAllowedImages');

    await screenshot.take('kubernetes');

    if (isWin) {
      await screenshot.take('wsl');
    }

    await preferencesPage.close({ runBeforeUnload: true });
  });
});
