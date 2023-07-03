import path from 'path';

import { test, expect, _electron, ElectronApplication } from '@playwright/test';

import { createDefaultSettings, packageLogs, startRancherDesktop, teardownApp } from './utils/TestUtils';

/**
 * Using test.describe.serial make the test execute step by step, as described on each `test()` order
 * Playwright executes test in parallel by default and it will not work for our app backend loading process.
 * */
test.describe.serial('startInBackground setting', () => {
  test.afterAll(async() => {
    await packageLogs(__filename);
  });

  test('window should appear when startInBackground is false', async() => {
    createDefaultSettings({ application: { startInBackground: false } });
    const electronApp = await startRancherDesktop(__filename);

    await expect(checkWindowOpened(electronApp)).resolves.toBe(true);
    const tracePath = path.join(__dirname, 'reports', `${ path.basename(__filename) }-startInBackgroundFalse.zip`);

    electronApp.context().tracing.stop({ path: tracePath });
    await teardownApp(electronApp);
  });

  test('window should not appear when startInBackground is true', async() => {
    createDefaultSettings({ application: { startInBackground: true } });
    const electronApp = await startRancherDesktop(__filename);

    await expect(checkWindowOpened(electronApp)).resolves.toBe(false);
    const tracePath = path.join(__dirname, 'reports', `${ path.basename(__filename) }-startInBackgroundTrue.zip`);

    electronApp.context().tracing.stop({ path: tracePath });
    await teardownApp(electronApp);
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
