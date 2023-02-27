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

/**
 * This file includes end-to-end testing for the HTTP control interface
 */

import os from 'os';
import path from 'path';

import { expect, test, _electron } from '@playwright/test';

import { NavPage } from './pages/nav-page';
import {
  createDefaultSettings, createUserProfile, kubectl, reportAsset, teardown,
} from './utils/TestUtils';

import type { LockedSettingsType, DeploymentProfileType } from '@pkg/config/settings';
import { Settings } from '@pkg/config/settings';
import { readDeploymentProfiles } from '@pkg/main/deploymentProfiles';
import { spawnFile } from '@pkg/utils/childProcess';
import { RecursivePartial } from '@pkg/utils/typeUtils';

import type { ElectronApplication, BrowserContext, Page } from '@playwright/test';

test.describe('Command server', () => {
  let electronApp: ElectronApplication;
  let context: BrowserContext;
  let page: Page;
  const appPath = path.join(__dirname, '../');
  let userSettingsProfile: RecursivePartial<Settings>|null = null;
  let userLocksProfile: LockedSettingsType|null = null;

  function rdctlPath() {
    return path.join(appPath, 'resources', os.platform(), 'bin', os.platform() === 'win32' ? 'rdctl.exe' : 'rdctl');
  }

  async function rdctl(commandArgs: string[]): Promise< { stdout: string, stderr: string, error?: any }> {
    try {
      return await spawnFile(rdctlPath(), commandArgs, { stdio: 'pipe' });
    } catch (err: any) {
      return {
        stdout: err?.stdout ?? '', stderr: err?.stderr ?? '', error: err,
      };
    }
  }

  async function saveUserProfile() {
    try {
      const result: DeploymentProfileType = readDeploymentProfiles();

      userSettingsProfile = Object.keys(result.defaults).length === 0 ? null : result.defaults;
      userLocksProfile = Object.keys(result.locked).length === 0 ? null : result.locked;
      await createUserProfile(userSettingsProfile, userLocksProfile);
    } catch { }
  }

  async function restoreUserProfile() {
    await createUserProfile(userSettingsProfile, userLocksProfile);
  }

  test.describe.configure({ mode: 'serial' });

  test.afterAll(async() => {
    await restoreUserProfile();
  });

  test.beforeAll(async() => {
    createDefaultSettings();
    await saveUserProfile();
    await createUserProfile(
      { containerEngine: { allowedImages: { enabled: true } } },
      { containerEngine: { allowedImages: { enabled: true } } },
    );
    electronApp = await _electron.launch({
      args: [
        appPath,
        '--disable-gpu',
        '--whitelisted-ips=',
        // See pkg/rancher-desktop/utils/commandLine.ts before changing the next item.
        '--disable-dev-shm-usage',
        '--no-modal-dialogs',
      ],
      env: {
        ...process.env,
        RD_LOGS_DIR: reportAsset(__filename, 'log'),
      },
    });
    context = electronApp.context();

    await context.tracing.start({
      screenshots: true,
      snapshots:   true,
    });
    page = await electronApp.firstWindow();
  });

  test.afterAll(() => teardown(electronApp, __filename));

  test('should load Kubernetes API', async() => {
    const navPage = new NavPage(page);

    await navPage.progressBecomesReady();
    await expect(navPage.progressBar).toBeHidden();

    expect(await kubectl('cluster-info')).toContain('is running at');
  });

  test('should not allow a locked field to be changed via rdctl set', async() => {
    const { stdout, stderr, error } = await rdctl(['list-settings']);

    expect({ stderr, error }).toEqual({ error: undefined, stderr: '' });
    const originalSettings = JSON.parse(stdout);
    const newEnabled = !originalSettings.containerEngine.allowedImages.enabled;

    await expect(rdctl(['set', `--container-engine.allowed-images.enabled=${ newEnabled }`]))
      .resolves.toMatchObject({
        stdout: '',
        stderr: expect.stringContaining("field 'containerEngine.allowedImages.enabled' is locked"),
      });
  });
});
