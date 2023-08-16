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
  clearSettings,
  clearUserProfile,
  testForFirstRunWindow,
  verifyNoSystemProfile,
} from '../utils/ProfileUtils';

test.describe.serial('KubernetesBackend', () => {
  let skipReasons: string[];
  let skipReason = '';

  test.beforeAll(async() => {
    await clearSettings();
    await clearUserProfile();
    skipReasons = await verifyNoSystemProfile();
    if (skipReasons.length > 0) {
      skipReason = `Profile requirements for this test: ${ skipReasons.join(', ') }`;
      console.log(`Skipping this test: ${ skipReason }`);
    }
  });

  test('should start with the first-run window', async() => {
    test.skip(!!process.env.CIRRUS_CI || skipReason !== '', skipReason);
    await testForFirstRunWindow(__filename);
  });
});
