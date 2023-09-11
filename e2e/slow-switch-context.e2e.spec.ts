/*
Copyright © 2022 SUSE LLC

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

import { expect, test } from '@playwright/test';
import _ from 'lodash';

import { NavPage } from './pages/nav-page';
import {
  createDefaultSettings, getAlternateSetting, kubectl, retry, startRancherDesktop, teardown, tool, waitForRestartVM,
} from './utils/TestUtils';

import {
  ContainerEngine,
  Settings,
  CURRENT_SETTINGS_VERSION,
} from '@pkg/config/settings';
import { PathManagementStrategy } from '@pkg/integrations/pathManager';
import { spawnFile } from '@pkg/utils/childProcess';
import { RecursivePartial } from '@pkg/utils/typeUtils';

import type { ElectronApplication, Page } from '@playwright/test';

test.describe('Command server', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  const appPath = path.join(__dirname, '../');

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

  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async() => {
    createDefaultSettings({ kubernetes: { enabled: true } });
    electronApp = await startRancherDesktop(__filename, { mock: false });
    page = await electronApp.firstWindow();
  });

  test.afterAll(() => teardown(electronApp, __filename));

  test('should load Kubernetes API', async() => {
    const navPage = new NavPage(page);

    await navPage.progressBecomesReady();

    expect(await retry(() => kubectl('cluster-info'))).toContain('is running at');
  });

  test.describe('rdctl', () => {
    test.describe('set', () => {
      test.describe('settings v5 migration', () => {
        /**
         * Note issue https://github.com/rancher-sandbox/rancher-desktop/issues/3829
         * calls for removing unrecognized fields in the existing settings.json file
         * Currently we're ignoring unrecognized fields in the PUT payload -- to complain about
         * them calls for another issue.
         */
        test('rejects old settings', async() => {
          const oldSettings: Settings = JSON.parse((await rdctl(['list-settings'])).stdout);
          const body: any = {
            // type 'any' because as far as the current configuration code is concerned,
            // it's an object with random fields and values
            version:    CURRENT_SETTINGS_VERSION,
            kubernetes: {
              memoryInGB:      oldSettings.virtualMachine.memoryInGB + 1,
              numberCPUs:      oldSettings.virtualMachine.numberCPUs + 1,
              containerEngine: getAlternateSetting(oldSettings, 'containerEngine.name', ContainerEngine.CONTAINERD, ContainerEngine.MOBY),
              suppressSudo:    oldSettings.application.adminAccess,
            },
            telemetry: !oldSettings.application.telemetry.enabled,
            updater:   !oldSettings.application.updater.enabled,
            debug:     !oldSettings.application.debug,
          };
          const addPathManagementStrategy = (oldSettings: Settings, body: any) => {
            body.pathManagementStrategy = getAlternateSetting(oldSettings,
              'application.pathManagementStrategy',
              PathManagementStrategy.Manual,
              PathManagementStrategy.RcFiles);
          };

          switch (os.platform()) {
          case 'darwin':
            body.kubernetes.experimental ??= {};
            body.kubernetes.experimental.socketVMNet = !oldSettings.experimental.virtualMachine.socketVMNet;
            addPathManagementStrategy(oldSettings, body);
            break;
          case 'linux':
            addPathManagementStrategy(oldSettings, body);
            break;
          case 'win32':
            body.kubernetes.WSLIntegrations ??= {};
            body.kubernetes.WSLIntegrations.bosco = true;
            body.kubernetes.hostResolver = !oldSettings.virtualMachine.hostResolver;
          }
          const { stdout, stderr, error } = await rdctl(['api', '/v1/settings', '-X', 'PUT', '-b', JSON.stringify(body)]);

          expect({
            stdout, stderr, error,
          }).toEqual({
            stdout: expect.stringContaining('no changes necessary'),
            stderr: '',
            error:  undefined,
          });
          const newSettings: Settings = JSON.parse((await rdctl(['list-settings'])).stdout);

          expect(newSettings).toEqual(oldSettings);
        });

        test('accepts new settings', async() => {
          const oldSettings: Settings = JSON.parse((await rdctl(['list-settings'])).stdout);
          const body: RecursivePartial<Settings> = {
            ...(os.platform() === 'win32' ? {} : {
              virtualMachine: {
                memoryInGB: oldSettings.virtualMachine.memoryInGB + 1,
                numberCPUs: oldSettings.virtualMachine.numberCPUs + 1,
              },
            }),
            version:     CURRENT_SETTINGS_VERSION,
            application: {
              // XXX: Can't change adminAccess until we can process the sudo-request dialog (and decline it)
              // adminAccess: !oldSettings.application.adminAccess,
              telemetry: { enabled: !oldSettings.application.telemetry.enabled },
              updater:   { enabled: !oldSettings.application.updater.enabled },
              debug:     !oldSettings.application.debug,
            },
            // This field is to force a restart
            kubernetes: { port: oldSettings.kubernetes.port + 1 },
          };

          if (process.platform !== 'win32' && body.application !== undefined) {
            body.application.pathManagementStrategy = getAlternateSetting(oldSettings,
              'application.pathManagementStrategy',
              PathManagementStrategy.Manual,
              PathManagementStrategy.RcFiles);
          }
          const { stdout, stderr, error } = await rdctl(['api', '/v1/settings', '-X', 'PUT', '-b', JSON.stringify(body)]);

          expect({
            stdout, stderr, error,
          }).toEqual({
            stdout: expect.stringContaining('reconfiguring Rancher Desktop to apply changes'),
            stderr: '',
            error:  undefined,
          });
          const newSettings: Settings = JSON.parse((await rdctl(['list-settings'])).stdout);

          expect(newSettings).toEqual(_.merge(oldSettings, body));

          // And now reinstate the old prefs so other tests that count on them will pass.
          const result = await rdctl(['api', '/v1/settings', '-X', 'PUT', '-b', JSON.stringify(oldSettings)]);

          expect(result.stderr).toEqual('');
          // Have to do this because we don't have any other way to see the current missing progress bar
          // and have the next  `progressBecomesReady` test pass prematurely.

          // Wait until progress bar show up. It takes roughly ~60s to start in CI
          const progressBar = page.locator('.progress');

          await waitForRestartVM(progressBar);

          // Since we just applied new settings, we must wait for the backend to restart.
          while (await progressBar.count() > 0) {
            await progressBar.waitFor({ state: 'detached', timeout: Math.round(240_000) });
          }
        });
      });
    });
    test('should verify nerdctl can talk to containerd', async() => {
      const { stdout } = await rdctl(['list-settings']);
      const settings: Settings = JSON.parse(stdout);

      if (settings.containerEngine.name !== ContainerEngine.CONTAINERD) {
        const payloadObject: RecursivePartial<Settings> = {
          version:         CURRENT_SETTINGS_VERSION,
          containerEngine: { name: ContainerEngine.CONTAINERD },
        };
        const navPage = new NavPage(page);

        await tool('rdctl', 'api', '/v1/settings', '--method', 'PUT', '--body', JSON.stringify(payloadObject));
        await waitForRestartVM(page.locator('.progress'));
        await navPage.progressBecomesReady();
      }
      const output = await retry(() => tool('nerdctl', 'info'));

      expect(output).toMatch(/Server Version:\s+v?[.0-9]+/);
    });
    test('should verify docker can talk to dockerd', async() => {
      const navPage = new NavPage(page);

      await tool('rdctl', 'set', '--container-engine', 'moby');
      await expect(navPage.progressBar).not.toBeHidden();
      await waitForRestartVM(navPage.progressBar);
      await navPage.progressBecomesReady();
      await expect(navPage.progressBar).toBeHidden();
      const output = await retry(() => tool('docker', 'info'), { delay: 500, tries: 60 });

      expect(output).toMatch(/Server Version:\s+v?[.0-9]+/);
    });
  });

  // Where is the test that pushes a supported update, you may be wondering?
  // The problem with a positive test is that it needs to restart the backend. The UI disappears
  // but the various back-end processes, as well as playwright, are still running.
  // This kind of test would be better done as a standalone BAT-type test that can monitor
  // the processes. Meanwhile, the unit tests verify that a valid payload should lead to an update.

  // There's also no test checking for oversize-payload detection because when I try to create a
  // payload > 2000 characters I get this error:
  // FetchError: request to http://127.0.0.1:6107/v1/set failed, reason: socket hang up
});
