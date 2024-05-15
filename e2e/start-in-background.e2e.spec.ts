import { test, expect, ElectronApplication } from '@playwright/test';

import { createDefaultSettings, startRancherDesktop, teardown, tool } from './utils/TestUtils';

/**
 * Using test.describe.serial make the test execute step by step, as described on each `test()` order
 * Playwright executes test in parallel by default and it will not work for our app backend loading process.
 * */
test.describe.serial('startInBackground setting', () => {
  test('window should appear when startInBackground is false', async({ colorScheme }, testInfo) => {
    createDefaultSettings({ application: { startInBackground: false } });
    const logVariant = `startInBackgroundFalse`;
    const electronApp = await startRancherDesktop(testInfo, { logVariant });

    await expect(checkWindowOpened(electronApp)).resolves.toBe(true);
    await teardown(electronApp, testInfo);
  });

  test('window should not appear when startInBackground is true', async({ colorScheme }, testInfo) => {
    createDefaultSettings({ application: { startInBackground: true } });
    const logVariant = `startInBackgroundTrue`;
    const electronApp = await startRancherDesktop(testInfo, { logVariant });

    await expect(checkWindowOpened(electronApp)).resolves.toBe(false);
    await tool('rdctl', 'set', '--application.start-in-background=false');
    await teardown(electronApp, testInfo);
  });
});

function checkWindowOpened(electronApp: ElectronApplication): Promise<boolean> {
  const promise = new Promise<boolean>((resolve) => {
    electronApp.on('window', () => resolve(true));
    setTimeout(() => resolve(false), 10_000);
  });

  // Check for any windows that may have been created since defining the
  // 'window' handler on electronApp
  for (const window of electronApp.windows()) {
    if (window.url().startsWith('app://')) {
      return Promise.resolve(true);
    }
  }

  return promise;
}
