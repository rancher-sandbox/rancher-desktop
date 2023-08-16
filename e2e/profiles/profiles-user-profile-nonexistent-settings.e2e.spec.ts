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

test.describe.serial('sys-profile with settings', () => {
  let skipReasons: string[];
  let skipReason = '';

  test.beforeAll(async() => {
    skipReasons = (await clearSettings());
    skipReasons.push(...(await clearUserProfile()));
    skipReasons.push(...(await verifyNoSystemProfile()));
    if (skipReasons.length > 0) {
      skipReason = `Profile requirements for this test: ${ skipReasons.join(', ') }`;
      console.log(`Skipping this test: ${ skipReason }`);
    }
    // Circumvent the type-checker by json-parsing a string of non-settings
    const s = `{ "fruits": ["oranges", "mangoes", { "citrus": ["lemons"] } ] }`;
    const s1 = JSON.parse(s);

    await createUserProfile(s1 as RecursivePartial<Settings>, null);
  });

  test('should start with the first-run window', async() => {
    test.skip(skipReason !== '', skipReason);
    await testForFirstRunWindow();
  });
});
