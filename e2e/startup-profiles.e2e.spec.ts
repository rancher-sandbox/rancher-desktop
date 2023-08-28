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

import {
  clearSettings,
  clearUserProfile,
  testForFirstRunWindow,
  testForNoFirstRunWindow,
  testWaitForLogfile,
  verifyNoSystemProfile,
  verifySettings,
  verifySystemProfile,
  verifyUserProfile,
} from './utils/ProfileUtils';
import { createUserProfile, reportAsset } from './utils/TestUtils';

import { Settings } from '@pkg/config/settings';
import * as childProcess from '@pkg/utils/childProcess';
import paths from '@pkg/utils/paths';
import { RecursivePartial } from '@pkg/utils/typeUtils';

async function createInvalidDarwinUserProfile(contents: string) {
  const userProfilePath = path.join(paths.deploymentProfileUser, 'io.rancherdesktop.profile.defaults.plist');

  await fs.promises.writeFile(userProfilePath, contents);
}

async function createInvalidLinuxUserProfile(contents: string) {
  const userProfilePath = path.join(paths.deploymentProfileUser, 'rancher-desktop.defaults.json');

  await fs.promises.writeFile(userProfilePath, contents);
}

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

async function createWrongDataUserRegistryProfile() {
  const base = 'HKCU\\SOFTWARE\\Rancher Desktop\\Profile\\Defaults\\kubernetes';

  await childProcess.spawnFile('reg',
    ['add', `${ base }`, '/v', 'version', '/f', '/t', 'REG_MULTI_SZ', '/d', 'strawberries\\0limes'],
    { stdio: ['ignore', 'pipe', 'pipe'] });
}

test.describe.serial('track startup windows based on existing profiles and settings', () => {
  test.afterAll(async() => {
    await clearUserProfile();
    await clearSettings();
  });
  test('verify profile/settings conditions and test skips or passes', async() => {
    // First time we want to verify there *is* a first-run window.
    // There should never be a first-run window after that.
    let runFunc = testForFirstRunWindow;
    let i = 0;

    for (const settingsFunc of [clearSettings, verifySettings]) {
      for (const userProfileFunc of [clearUserProfile, verifyUserProfile]) {
        for (const systemProfileFunc of [verifyNoSystemProfile, verifySystemProfile]) {
          const skipReasons = await systemProfileFunc();

          if (skipReasons.length > 0) {
            console.log(`Skipping test where ${ systemProfileFunc === verifySystemProfile ? "there's no system profile" : 'there is a system profile' }`);
          } else {
            await settingsFunc();
            await userProfileFunc();
            await runFunc(`${ __filename }-${ i }`);
          }
          i += 1;
          runFunc = testForNoFirstRunWindow;
        }
      }
    }
  });

  test.describe('problematic user profiles', () => {
    let skipReasons: string[];

    test.beforeEach(async() => {
      await clearSettings();
      await clearUserProfile();
      skipReasons = await verifyNoSystemProfile();
    });

    test('non-existent settings', async() => {
      test.skip(skipReasons.length > 0, `Profile requirements for this test: ${ skipReasons.join(', ') }`);
      if (process.platform === 'win32') {
        await createNonexistentDataUserRegistryProfile();
      } else {
        // Circumvent the type-checker by json-parsing a string of non-settings
        const s = `{ "fruits": {"oranges": 5, "mangoes": true, "citrus": "lemons" } }`;
        const s1 = JSON.parse(s);

        await createUserProfile(s1 as RecursivePartial<Settings>, null);
      }
      await testForFirstRunWindow(`${ __filename }-non-existent-settings`);
    });

    test('invalid format', async() => {
      let errorMatcher: RegExp;
      const filename = `${ __filename }-invalid-profile-format`;
      const logDir = reportAsset(filename, 'log');
      const logPath = path.join(logDir, 'background.log');

      if (process.platform === 'win32') {
        skipReasons.push(`This test doesn't make sense on Windows`);
      }
      test.skip(skipReasons.length > 0, `Profile requirements for this test: ${ skipReasons.join(', ') }`);
      switch (process.platform) {
      case 'darwin':
        await createInvalidDarwinUserProfile(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>kubernetes</key>
    <dict>
      <key>version</key>
      <array>
        <string>str`);
        errorMatcher = new RegExp(`Error loading plist file ${ path.join(paths.deploymentProfileUser, 'io.rancherdesktop.profile.defaults.plist') }.*Property List error: Encountered unexpected EOF`);
        break;
      case 'linux':
        await createInvalidLinuxUserProfile(`{"kubernetes":{"version":["str`);
        errorMatcher = new RegExp(`Error starting up: DeploymentProfileError: Error parsing deployment profile from ${ path.join(paths.deploymentProfileUser, 'rancher-desktop.defaults.json') }: SyntaxError: Unterminated string in JSON`);
        break;
      default:
        throw new Error(`Not expecting to handle platform ${ process.platform }`);
      }
      const windowCount = await testWaitForLogfile(filename, logPath);
      const contents = await fs.promises.readFile(logPath, { encoding: 'utf-8' });

      expect(windowCount).toEqual(0);
      expect(contents).toContain('Fatal Error:');
      expect(contents).toMatch(errorMatcher);
    });

    test('wrong datatype in profile', async() => {
      const filename = `${ __filename }-wrong-datatype-in-profile`;
      const logDir = reportAsset(filename, 'log');
      const logPath = path.join(logDir, 'background.log');

      test.skip(skipReasons.length > 0, `Profile requirements for this test: ${ skipReasons.join(', ') }`);
      if (process.platform === 'win32') {
        await createWrongDataUserRegistryProfile();
      } else {
        // Use JSON.parse to bypass the typescript type-checker
        const s = `{"kubernetes":{"version":["strawberries","limes"]}}`;
        const s1 = JSON.parse(s) as RecursivePartial<Settings>;

        await createUserProfile(s1, null);
      }
      const windowCount = await testWaitForLogfile(filename, logPath);
      const contents = await fs.promises.readFile(logPath, { encoding: 'utf-8' });

      expect(windowCount).toEqual(0);
      expect(contents).toContain('Fatal Error:');
      if (process.platform === 'win32') {
        expect(contents).toContain(`Error for field 'HKCU\\SOFTWARE\\Rancher Desktop\\Profile\\Defaults\\kubernetes\\version'`);
        expect(contents).toContain(`expecting value of type string, got an array '["strawberries","limes"]'`);
      } else {
        expect(contents).toMatch(new RegExp(`Error in deployment file.*${ paths.deploymentProfileUser }.*defaults`));
        expect(contents).toContain(`Error for field 'kubernetes.version':`);
        expect(contents).toContain(`expecting value of type string, got an array ["strawberries","limes"]`);
      }
    });
  });
});
