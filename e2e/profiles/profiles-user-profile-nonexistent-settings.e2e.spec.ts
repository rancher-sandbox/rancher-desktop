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

import { test } from '@playwright/test';

import {
  testForFirstRunWindow,
  clearSettings,
  clearUserProfile,
  verifyNoSystemProfile,
} from '../utils/ProfileUtils';
import { createUserProfile } from '../utils/TestUtils';

import { Settings } from '@pkg/config/settings';
import { RecursivePartial } from '@pkg/utils/typeUtils';
import * as childProcess from '~/utils/childProcess';

async function createNonexistentDataUserRegistryProfile() {
  const base = 'HKCU\\SOFTWARE\\Rancher Desktop\\Profile\\Defaults\\fruits';

  await childProcess.spawnFile('reg',
    ['add', `${ base }`, '/v', 'oranges', '/f', '/t', 'REG_DWORD', '/d', '5'],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  await childProcess.spawnFile('reg',
    ['add', `${ base }`, '/v', 'mangoes', '/f', '/t', 'REG_DWORD', '/d', '1'],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  await childProcess.spawnFile('reg',
    ['add', `${ base }`, '/v', 'citrus', '/f', '/t', 'REG_SZ', '/d', 'lemons'],
    { stdio: ['ignore', 'pipe', 'pipe'] });
}

test.describe.serial('sys-profile with settings', () => {
  let skipReasons: string[];
  let skipReason = '';

  test.beforeAll(async() => {
    await clearSettings();
    await clearUserProfile();
    skipReasons = await verifyNoSystemProfile();
    if (process.platform === 'win32') {
      skipReasons.push(`This test won't work on Windows because the json->reg converter ignores non-settings`);
    }
    if (skipReasons.length > 0) {
      skipReason = `Profile requirements for this test: ${ skipReasons.join(', ') }`;
      console.log(`Skipping this test: ${ skipReason }`);
    }
    if (process.platform === 'win32') {
      await createNonexistentDataUserRegistryProfile();
    } else {
      // Circumvent the type-checker by json-parsing a string of non-settings
      const s = `{ "fruits": {"oranges": 5, "mangoes": true, "citrus": "lemons" } }`;
      const s1 = JSON.parse(s);

      await createUserProfile(s1 as RecursivePartial<Settings>, null);
    }
  });

  test.afterAll(async() => {
    // The invalid user-profiles can interfere with subsequent tests.
    await clearSettings();
    await clearUserProfile();
  });

  test('should start with the first-run window', async() => {
    test.skip(!!process.env.CIRRUS_CI || skipReason !== '', skipReason);
    await testForFirstRunWindow(__filename);
  });
});
