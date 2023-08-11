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
  clearSettings, clearUserProfiles, startRancherDesktop, teardown, tool, verifyNoSystemProfiles,
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
    skipReasons.push(...(await verifyNoSystemProfiles()));
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

  test('should start with the first-run window', async() => {
    test.skip(skipReason !== '', skipReason);
    let windowCount = 0;
    let windowCountForMainPage = 0;

    electronApp = await startRancherDesktop(__filename, { mock: false, noModalDialogs: false });
    electronApp.on('window', async(openedPage: Page) => {
      windowCount += 1;
      // console.log(`QQQ: window # ${ windowCount }`);
      // try {
      //   const title = await openedPage.title();
      //   console.log(`QQQ: window # ${ windowCount }, title: <${ title }>`);
      // } catch (e) {
      //   console.error(`bad #1 happened: ${ e }`, e);
      // }
      // try {
      //   console.log(`QQQ: contents: ${ JSON.stringify(await openedPage.content()) }`);
      // } catch (e) {
      //   console.error(`bad #2 happened: ${ e }`, e);
      // }
      if (windowCount === 1) {
        // try {
        //   const button = openedPage.getByText('shnopskers');
        //   if (button) {
        //     console.log(`QQQ: about to click on non-existent button`);
        //     await button.click({ timeout: 1 });
        //     expect('should have thrown an exception').toEqual("didn't throw an exception");
        //   } else {
        //     // console.log(`QQQ: no shnopskers  button to click on`);
        //   }
        // } catch (e) {
        //   console.error(`QQQ: error when clicking on a non-button: ${ e }`, e);
        // }
        const button = openedPage.getByText('OK');

        await util.promisify(setTimeout)(1_000);
        if (button) {
          await button.click();
        }

        return;
      }
      navPage = new NavPage(openedPage);

      try {
        await expect(navPage.mainTitle).toHaveText('Welcome to Rancher Desktop');
        // console.log(`QQQ: Saw the main title...`);
        page = openedPage;
        windowCountForMainPage = windowCount;

        return;
      } catch (ex: any) {
        console.log(`Ignoring failed title-test: ${ ex.toString().substring(0, 10000) }`);
      }
      // try {
      //   console.log(`QQQ: contents: ${ JSON.stringify(await openedPage.content()).substring(0, 10000) }`);
      // } catch (e) {
      //   console.error(`bad #2 happened: ${ e }`, e);
      // }
    });

    // console.log(`QQQ: let's sit around and wait until page is defined...`);
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
    // console.log(`QQQ: stopped waiting since we have a main page`);
    expect(windowCountForMainPage).toEqual(2);
    console.log(`Shutting down now because this test is finished...`);
    await tool('rdctl', 'shutdown', '--verbose');
    electronApp = undefined;
  });
});
