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

import fs from 'fs';
import path from 'path';

import { expect, test } from '@playwright/test';

import { clearSettings, clearUserProfile, runWaitForLogfile, verifyNoSystemProfile } from '../utils/ProfileUtils';
import { createUserProfile, reportAsset } from '../utils/TestUtils';

import { Settings } from '@pkg/config/settings';
import paths from '@pkg/utils/paths';
import { RecursivePartial } from '@pkg/utils/typeUtils';

const logDir = reportAsset(__filename, 'log');
const logPath = path.join(logDir, 'background.log');

test.describe.serial('KubernetesBackend', () => {
  let skipReasons: string[];
  let skipReason = '';

  test.beforeAll(async() => {
    await fs.promises.rm(logPath, { force: true });
    skipReasons = (await clearSettings());
    skipReasons.push(...(await clearUserProfile()));
    skipReasons.push(...(await verifyNoSystemProfile()));
    if (process.platform === 'win32') {
      skipReasons.push('Not running on Windows yet');
    }
    if (skipReasons.length > 0) {
      skipReason = `Profile requirements for this test: ${ skipReasons.join(', ') }`;
      console.log(`Skipping this test: ${ skipReason }`);
    }
    // Use JSON.parse to bypass the typescript type-checker
    const s = `{"kubernetes":{"version":["strawberries","limes"]}}`;
    const s1 = JSON.parse(s) as RecursivePartial<Settings>;

    await createUserProfile(s1, null);
  });

  test('should see logs complaining about wrong type', async() => {
    test.skip(skipReason !== '', skipReason);
    const windowCount = await runWaitForLogfile(__filename, logPath);
    const contents = await fs.promises.readFile(logPath, { encoding: 'utf-8' });

    expect(windowCount).toEqual(0);
    expect(contents).toContain('Fatal Error:');
    expect(contents).toMatch(new RegExp(`Error in deployment file.*${ paths.deploymentProfileUser }.*defaults`));
    expect(contents).toContain(`Error for field 'kubernetes.version': expecting value of type string, got an array ["strawberries","limes"]`);
  });
});
