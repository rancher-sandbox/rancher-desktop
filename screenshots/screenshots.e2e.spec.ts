import path from 'path';

import { test, expect } from '@playwright/test';
import { ElectronApplication, BrowserContext, _electron, Page } from 'playwright';

import { NavPage } from '../e2e/pages/nav-page';
import { PreferencesPage } from '../e2e/pages/preferences';
import { createDefaultSettings, packageLogs, reportAsset } from '../e2e/utils/TestUtils';
import { MainWindowScreenshots, PreferencesScreenshots } from './Screenshots';

import { isWin } from '~/utils/platform';

const darkTheme = process.env.THEME === 'dark';
const themePrefix = `${ darkTheme ? 'dark' : 'light' }`;

async function setTheme(page: Page) {
  if (darkTheme) {
    await page.emulateMedia({ colorScheme: 'dark' });
  }
}

test.describe.serial('Main App Test', () => {
  let electronApp: ElectronApplication;
  let context: BrowserContext;
  let page: Page;
  let navPage: NavPage;

  test.beforeAll(async() => {
    createDefaultSettings();

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

    await setTheme(page);

    await navPage.progressBecomesReady();
  });

  test.afterAll(async() => {
    await context.tracing.stop({ path: reportAsset(__filename) });
    await packageLogs(__filename);
    await electronApp.close();
  });

  test('Main Page', async() => {
    const screenshot = new MainWindowScreenshots(page, { directory: `${ themePrefix }/main` });

    await screenshot.take('General');
    await screenshot.take('PortForwarding', navPage);

    const imagesPage = await navPage.navigateTo('Images');

    await expect(imagesPage.rows).toBeVisible();
    await screenshot.take('Images');

    await screenshot.take('Troubleshooting', navPage);
    await screenshot.take('Diagnostics', navPage);
  });

  test('Preferences Page', async() => {
    await navPage.preferencesButton.click();

    await electronApp.waitForEvent('window', page => /preferences/i.test(page.url()));

    // gets full content of preferences window
    const preferencesPage = electronApp.windows()[1];

    await setTheme(preferencesPage);

    const e2ePreferences = new PreferencesPage(preferencesPage);
    const screenshot = new PreferencesScreenshots(preferencesPage, e2ePreferences, { directory: `${ themePrefix }/preferences` });

    // enable Apply button
    await e2ePreferences.application.automaticUpdatesCheckbox.click();
    await preferencesPage.waitForTimeout(200);

    await screenshot.take('application', 'tabBehavior');

    if (!isWin) {
      await e2ePreferences.application.tabEnvironment.click();
      await expect(e2ePreferences.application.pathManagement).toBeVisible();
      await screenshot.take('application', 'tabEnvironment');

      await screenshot.take('virtualMachine');
    }

    await screenshot.take('containerEngine', 'tabGeneral');

    await e2ePreferences.containerEngine.tabAllowedImages.click();
    await expect(e2ePreferences.containerEngine.allowedImages).toBeVisible();
    await screenshot.take('containerEngine', 'tabAllowedImages');

    await screenshot.take('kubernetes');

    if (isWin) {
      await screenshot.take('wsl');
    }

    preferencesPage.close({ runBeforeUnload: true });
  });
});
