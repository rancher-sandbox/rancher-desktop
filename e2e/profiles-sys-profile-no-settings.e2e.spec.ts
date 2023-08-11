/*
Copyright © 2023 SUSE LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import util from 'util';

import { test, expect } from '@playwright/test';

import { NavPage } from './pages/nav-page';
import {
  clearSettings,
  clearUserProfiles,
  startRancherDesktop,
  teardown,
  tool,
  verifySystemProfiles,
} from './utils/TestUtils';

import type { ElectronApplication, Page } from '@playwright/test';

test.describe.serial('KubernetesBackend', () => {
  let electronApp: ElectronApplication|undefined;
  let page: Page;
  let navPage: NavPage;
  let skipReasons: string[];
  let skipReason = '';

  test.beforeAll(async() => {
    skipReasons = (await clearSettings());
    skipReasons.push(...(await clearUserProfiles()));
    skipReasons.push(...(verifySystemProfiles()));
    if (skipReasons.length > 0) {
      skipReason = `Existing profiles need to be deleted: ${ skipReasons.join(', ') }`;
      console.log(`Skipping this test: ${ skipReason }`);
    }
  });

  test.afterAll(() => {
    if (electronApp) {
      teardown(electronApp, __filename);
    }
  });

  test('should start with the main window', async() => {
    test.skip(skipReason !== '', skipReason);
    let windowCount = 0;
    let windowCountForMainPage = 0;

    electronApp = await startRancherDesktop(__filename, { mock: false, noModalDialogs: false });
    electronApp.on('window', async(openedPage: Page) => {
      windowCount += 1;
      navPage = new NavPage(openedPage);

      try {
        await expect(navPage.mainTitle).toHaveText('Welcome to Rancher Desktop');
        page = openedPage;
        windowCountForMainPage = windowCount;

        return;
      } catch (ex: any) {
        console.log(`Ignoring failed title-test: ${ ex.toString().substring(0, 2000) }`);
      }
      try {
        const button = openedPage.getByText('OK');

        await button.click( { timeout: 1000 });
        expect("Didn't expect to see a first-run window").toEqual('saw the first-run window');
      } catch (e) {
        console.error(`Expecting to get an error when clicking on a non-button: ${ e }`, e);
      }
    });

    let iter = 0;
    const start = new Date().valueOf();
    const limit = 300 * 1_000 + start;

    // eslint-disable-next-line no-unmodified-loop-condition
    while (page === undefined) {
      const now = new Date().valueOf();

      iter += 1;
      if (iter % 100 === 0) {
        console.log(`waiting for main window, iter ${ iter }...`);
      }
      if (now > limit) {
        throw new Error(`timed out waiting for ${ limit / 1000 } seconds`);
      }
      await util.promisify(setTimeout)(100);
    }
    expect(windowCountForMainPage).toEqual(1);
    console.log(`Shutting down now because this test is finished...`);
    await tool('rdctl', 'shutdown', '--verbose');
    electronApp = undefined;
  });
});
