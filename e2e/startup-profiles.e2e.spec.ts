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
import _ from 'lodash';

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
import { setUserProfile, reportAsset } from './utils/TestUtils';

import { CURRENT_SETTINGS_VERSION, Settings } from '@pkg/config/settings';
import { PathManagementStrategy } from '@pkg/integrations/pathManager';
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

async function addRegistryEntry(path: string, name: string, valueType: string, value: string) {
  await childProcess.spawnFile('reg',
    ['add', path, '/v', name, '/f', '/t', valueType, '/d', value],
    { stdio: ['ignore', 'pipe', 'pipe'] });
}

async function createDefaultUserRegistryProfileWithNonexistentFields() {
  let base = 'HKCU\\SOFTWARE\\Rancher Desktop\\Profile\\Defaults';

  await addRegistryEntry(base, 'version', 'REG_DWORD', '10');

  base += '\\fruits';
  await addRegistryEntry(base, 'oranges', 'REG_DWORD', '5');
  await addRegistryEntry(base, 'mangoes', 'REG_DWORD', '1');
  await addRegistryEntry(base, 'citrus', 'REG_SZ', 'lemons');
}

async function createDefaultUserRegistryProfileWithIncorrectTypes() {
  let base = 'HKCU\\SOFTWARE\\Rancher Desktop\\Profile\\Defaults';

  await addRegistryEntry(base, 'version', 'REG_DWORD', '10');

  base += '\\kubernetes';
  await addRegistryEntry(base, 'version', 'REG_MULTI_SZ', 'strawberries\\0limes');
}

async function createDefaultUserRegistryProfileWithValidDataButNoVersion() {
  const base = 'HKCU\\SOFTWARE\\Rancher Desktop\\Profile\\Defaults\\kubernetes';

  await addRegistryEntry(base, 'version', 'REG_SZ', '1.21.0');
}

async function createLockedUserRegistryProfileWithValidDataButNoVersion() {
  const base = 'HKCU\\SOFTWARE\\Rancher Desktop\\Profile\\Locked\\kubernetes';

  await addRegistryEntry(base, 'version', 'REG_SZ', '1.21.0');
}

test.describe.serial('starting up with profiles', () => {
  test.afterAll(async() => {
    await clearUserProfile();
    await clearSettings();
  });
  test.describe.serial('profile combinations', () => {
    // First time we want to verify there *is* a first-run window.
    // There should never be a first-run window after that.
    let runFunc = testForFirstRunWindow;
    let i = 0;
    let numSkipped = 0;

    for (const settingsFunc of [clearSettings, verifySettings]) {
      for (const userProfileFunc of [clearUserProfile, verifyUserProfile]) {
        for (const systemProfileFunc of [verifyNoSystemProfile, verifySystemProfile]) {
          test(`Standard test ${ i }: ${ settingsFunc.name } / ${ userProfileFunc.name } / ${ systemProfileFunc.name }`, async({ colorScheme }, testInfo) => {
            const skipReasons = await systemProfileFunc();

            if (skipReasons.length > 0) {
              console.log(`Skipping test (${ systemProfileFunc.name })`);
              numSkipped += 1;
            } else {
              await settingsFunc();
              await userProfileFunc();
              await runFunc(testInfo, { logVariant: `${ i }` });
              runFunc = testForNoFirstRunWindow;
            }
          });
          i++;
        }
      }
    }
    test('check for correct number of tests', () => {
      // Half the tests require a system profile, half require no system-profile, so we should always skip half of them.
      expect(numSkipped).toEqual(4);
    });
  });

  test.describe('problematic user profiles', () => {
    let skipReasons: string[];

    test.beforeEach(async() => {
      await clearSettings();
      await clearUserProfile();
      skipReasons = await verifyNoSystemProfile();
    });

    test('nonexistent settings act like an empty default profile', async({ colorScheme }, testInfo) => {
      test.skip(skipReasons.length > 0, `Profile requirements for this test: ${ skipReasons.join(', ') }`);
      if (process.platform === 'win32') {
        await createDefaultUserRegistryProfileWithNonexistentFields();
      } else {
        const s1 = {
          version: 10,
          fruits:  {
            oranges: 5, mangoes: true, citrus: 'lemons',
          },
        } as unknown as RecursivePartial<Settings>;

        await setUserProfile(s1, null);
      }
      // We have a deployment with only a version field, good enough to bypass the first-run dialog.
      await testForNoFirstRunWindow(testInfo, { logVariant: 'nonexistent-settings' });
    });

    test('invalid format', async({ colorScheme }, testInfo) => {
      let errorMatcher: RegExp;
      const logVariant = 'invalid-profile-format';
      const localSkipReasons = [...skipReasons];

      if (process.platform === 'win32') {
        localSkipReasons.push(`This test doesn't make sense on Windows`);
      }
      test.skip(localSkipReasons.length > 0, `Profile requirements for this test: ${ localSkipReasons.join(', ') }`);
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
      const windowCount = await testWaitForLogfile(testInfo, { logVariant });
      const logPath = path.join(reportAsset(testInfo, 'log'), 'background.log');
      const contents = await fs.promises.readFile(logPath, { encoding: 'utf-8' });

      expect(windowCount).toEqual(0);
      expect(contents).toContain('Fatal Error:');
      expect(contents).toMatch(errorMatcher);
    });

    test('missing version', async({ colorScheme }, testInfo) => {
      const logVariant = 'missing-settings-version';
      const versionLessSettings: RecursivePartial<Settings> = {
        kubernetes:  { enabled: true },
        application: {
          debug:                  true,
          pathManagementStrategy: PathManagementStrategy.Manual,
          startInBackground:      false,
        },
      };
      const settingsFullPath = path.join(paths.config, 'settings.json');

      await fs.promises.mkdir(paths.config, { recursive: true });
      await fs.promises.writeFile(settingsFullPath, JSON.stringify(versionLessSettings));
      const windowCount = await testWaitForLogfile(testInfo, { logVariant });
      const logPath = path.join(reportAsset(testInfo, 'log'), 'background.log');
      const contents = await fs.promises.readFile(logPath, { encoding: 'utf-8' });

      expect(windowCount).toEqual(0);
      const msg = `No version specified in ${ settingsFullPath }`;

      expect(contents).toMatch(new RegExp(`Fatal Error:.*${ _.escapeRegExp(msg) }`, 's'));
    });

    test('wrong datatype in profile', async({ colorScheme }, testInfo) => {
      const logVariant = 'wrong-datatype-in-profile';

      test.skip(skipReasons.length > 0, `Profile requirements for this test: ${ skipReasons.join(', ') }`);
      if (process.platform === 'win32') {
        await createDefaultUserRegistryProfileWithIncorrectTypes();
      } else {
        const s1 = { version: 10, kubernetes: { version: ['strawberries', 'limes'] } } as unknown as RecursivePartial<Settings>;

        await setUserProfile(s1, null);
      }
      const windowCount = await testWaitForLogfile(testInfo, { logVariant });
      const logPath = path.join(reportAsset(testInfo, 'log'), 'background.log');
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

    test('missing version in defaults deployment profile', async({ colorScheme }, testInfo) => {
      const logVariant = `missing-version-in-defaults-profile`;

      test.skip(skipReasons.length > 0, `Profile requirements for this test: ${ skipReasons.join(', ') }`);
      if (process.platform === 'win32') {
        await createDefaultUserRegistryProfileWithValidDataButNoVersion();
      } else {
        await setUserProfile({ kubernetes: { enabled: false } }, null);
      }
      const windowCount = await testWaitForLogfile(testInfo, { logVariant });
      const logPath = path.join(reportAsset(testInfo, 'log'), 'background.log');
      const contents = await fs.promises.readFile(logPath, { encoding: 'utf-8' });

      expect(windowCount).toEqual(0);
      expect(contents).toContain('Fatal Error:');
      if (process.platform === 'win32') {
        expect(contents).toContain('Invalid default-deployment: no version specified at HKCU\\SOFTWARE\\Rancher Desktop\\Profile\\Defaults.');
        expect(contents).toContain(`You'll need to add a version field to make it valid (current version is ${ CURRENT_SETTINGS_VERSION }).`);
      } else {
        expect(contents).toContain('Failed to load the deployment profile');
        expect(contents).toMatch(/Invalid deployment file.*defaults.*: no version specified. You'll need to add a version field to make it valid/);
      }
    });

    test('missing version in locked deployment profile', async({ colorScheme }, testInfo) => {
      const logVariant = 'missing-version-in-locked-profile';

      test.skip(skipReasons.length > 0, `Profile requirements for this test: ${ skipReasons.join(', ') }`);
      if (process.platform === 'win32') {
        await createLockedUserRegistryProfileWithValidDataButNoVersion();
      } else {
        await setUserProfile(null, { kubernetes: { enabled: false } });
      }
      const windowCount = await testWaitForLogfile(testInfo, { logVariant });
      const logPath = path.join(reportAsset(testInfo, 'log'), 'background.log');
      const contents = await fs.promises.readFile(logPath, { encoding: 'utf-8' });

      expect(windowCount).toEqual(0);
      expect(contents).toContain('Fatal Error:');
      if (process.platform === 'win32') {
        expect(contents).toContain('Invalid locked-deployment: no version specified at HKCU\\SOFTWARE\\Rancher Desktop\\Profile\\Locked.');
        expect(contents).toContain(`You'll need to add a version field to make it valid (current version is ${ CURRENT_SETTINGS_VERSION }).`);
      } else {
        expect(contents).toContain('Failed to load the deployment profile');
        expect(contents).toMatch(/Invalid deployment file.*locked.*: no version specified. You'll need to add a version field to make it valid/);
      }
    });
  });
});
