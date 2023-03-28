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

import fs from 'fs';
import os from 'os';
import path from 'path';

import { expect, test, _electron } from '@playwright/test';
import fetch from 'node-fetch';

import { NavPage } from './pages/nav-page';
import {
  createDefaultSettings, kubectl, reportAsset, retry, teardown, tool,
} from './utils/TestUtils';

import {
  ContainerEngine,
  Settings,
} from '@pkg/config/settings';
import { ServerState } from '@pkg/main/commandServer/httpCommandServer';
import { spawnFile } from '@pkg/utils/childProcess';
import paths from '@pkg/utils/paths';

import type { ElectronApplication, BrowserContext, Page } from '@playwright/test';

test.describe('Command server', () => {
  let electronApp: ElectronApplication;
  let context: BrowserContext;
  let serverState: ServerState;
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

    expect(await retry(() => kubectl('cluster-info'))).toContain('is running at');
  });

  test('should emit connection information', async() => {
    const dataPath = path.join(paths.appHome, 'rd-engine.json');
    const dataRaw = await fs.promises.readFile(dataPath, 'utf-8');

    serverState = JSON.parse(dataRaw);
    expect(serverState).toEqual(expect.objectContaining({
      user:     expect.any(String),
      password: expect.any(String),
      port:     expect.any(Number),
      pid:      expect.any(Number),
    }));
  });

  test('should require authentication, settings request', async() => {
    const url = `http://127.0.0.1:${ serverState.port }/v1/settings`;
    const resp = await fetch(url);

    expect(resp).toEqual(expect.objectContaining({
      ok:     false,
      status: 401,
    }));
  });

  test.describe('rdctl-extensions', () => {
    const STD_EXTENSION_NAME = 'rd/extension/ui';

    test('verify running on moby', async() => {
      const { stdout } = await rdctl(['list-settings']);
      const settings: Settings = JSON.parse(stdout);

      if (settings.containerEngine.name !== ContainerEngine.MOBY) {
        const navPage = new NavPage(page);

        await tool('rdctl', 'set', '--container-engine', 'moby');
        // await expect(navPage.progressBar).not.toBeHidden();
        await navPage.progressBecomesReady();
        // await expect(navPage.progressBar).toBeHidden();
        const output = await retry(() => tool('docker', 'info'), { delay: 500, tries: 60 });

        expect(output).toMatch(/Server Version:\s+v?[.0-9]+/);
      }
    });
    test('build the extension if needed', async() => {
      const stdout = await tool('docker', 'images', '--format', '{{json .Repository}}');

      if (!stdout.includes(STD_EXTENSION_NAME)) {
        const srcDir = path.dirname(path.dirname(__filename));
        const dataDir = path.join(srcDir, 'bats', 'tests', 'extensions', 'testdata');

        await tool('docker', 'build', '--tag', STD_EXTENSION_NAME, '--build-arg', 'variant=ui', dataDir);
        const stdout = await tool('docker', 'images', '--format', '{{json .Repository}}');

        expect(stdout).toContain(STD_EXTENSION_NAME);
      }
    });

    test('can add an extension', async() => {
      // Delete the standard extension if it exists
      let haveStdExtension = false;
      let error: any;
      let { stdout, stderr } = await rdctl(['api', '/v1/extensions']);
      // Is it plural or not. Set it once and forget it
      const EXTENSION_COMMAND_NAME = 'extension';

      expect(stderr).toBe('');
      if (stdout) {
        const installed = JSON.parse(stdout);

        if (STD_EXTENSION_NAME in installed) {
          haveStdExtension = true;
        }
      }
      if (haveStdExtension) {
        const { stdout, stderr, error } = await rdctl([EXTENSION_COMMAND_NAME, 'uninstall', STD_EXTENSION_NAME]);

        expect({
          stdout, stderr, error,
        }).toEqual({
          error:  undefined,
          stderr: '',
          stdout: expect.stringContaining(`Deleted ${ STD_EXTENSION_NAME }`),
        });
      }

      // (re)install
      await new Promise(resolve => setTimeout(resolve, 5_000));
      ({ stdout, stderr, error } = await rdctl([EXTENSION_COMMAND_NAME, 'install', STD_EXTENSION_NAME]));
      expect({
        stdout, stderr, error,
      }).toEqual({
        error:  undefined,
        stderr: '',
        stdout: expect.stringContaining('Created'),
      });

      // Verify it's present
      ({ stdout, stderr, error } = await rdctl([EXTENSION_COMMAND_NAME, 'ls']));
      expect({
        stdout, stderr, error,
      }).toEqual({
        error:  undefined,
        stderr: '',
        stdout: expect.stringContaining(STD_EXTENSION_NAME),
      });

      // uninstall
      ({ stdout, stderr, error } = await rdctl([EXTENSION_COMMAND_NAME, 'uninstall', STD_EXTENSION_NAME]));
      expect({
        stdout, stderr, error,
      }).toEqual({
        error:  undefined,
        stderr: '',
        stdout: expect.stringContaining(`Deleted ${ STD_EXTENSION_NAME }`),
      });
    });
  });
});
