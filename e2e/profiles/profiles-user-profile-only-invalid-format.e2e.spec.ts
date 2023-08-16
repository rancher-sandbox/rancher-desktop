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
import { reportAsset } from '../utils/TestUtils';

import paths from '@pkg/utils/paths';

const logDir = reportAsset(__filename, 'log');
const logPath = path.join(logDir, 'background.log');

async function createInvalidLinuxUserProfile(contents: string) {
  const userProfilePath = path.join(paths.deploymentProfileUser, 'rancher-desktop.defaults.json');

  await fs.promises.writeFile(userProfilePath, contents);
}

async function createInvalidDarwinUserProfile(contents: string) {
  const userProfilePath = path.join(paths.deploymentProfileUser, 'io.rancherdesktop.profile.defaults.plist');

  await fs.promises.writeFile(userProfilePath, contents);
}

test.describe.serial('KubernetesBackend', () => {
  let skipReasons: string[];
  let skipReason = '';
  let errorMatcher: RegExp;

  test.beforeAll(async() => {
    await fs.promises.rm(logPath, { force: true });
    await clearSettings();
    await clearUserProfile();
    skipReasons = await verifyNoSystemProfile();
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
    case 'win32':
      skipReasons.push(`This test doesn't make sense on Windows yet`);
      break;
    default:
      throw new Error(`Not expecting to handle platform ${ process.platform }`);
    }
    if (skipReasons.length > 0) {
      skipReason = `Profile requirements for this test: ${ skipReasons.join(', ') }`;
      console.log(`Skipping this test: ${ skipReason }`);
    }
  });

  test.afterAll(async() => {
    // The invalid user-profiles can interfere with subsequent tests.
    await clearSettings();
    if (process.platform !== 'win32') {
      await clearUserProfile();
    }
  });

  test('should see logs complaining about invalid profile structure', async() => {
    test.skip(!!process.env.CIRRUS_CI || skipReason !== '', skipReason);
    const windowCount = await runWaitForLogfile(__filename, logPath);
    const contents = await fs.promises.readFile(logPath, { encoding: 'utf-8' });

    expect(windowCount).toEqual(0);
    expect(contents).toContain('Fatal Error:');
    expect(contents).toMatch(errorMatcher);
    expect(windowCount).toEqual(0);
  });
});
