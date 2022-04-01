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
import path from 'path';

import os from 'os';
import { expect, test } from '@playwright/test';
import { BrowserContext, ElectronApplication, Page, _electron } from 'playwright';

import fetch, { RequestInit } from 'node-fetch';
import _ from 'lodash';
import { createDefaultSettings, kubectl, playwrightReportAssets } from './utils/TestUtils';
import { NavPage } from './pages/nav-page';
import paths from '@/utils/paths';
import { spawnFile } from '@/utils/childProcess';
import { ServerState } from '@/main/commandServer/httpCommandServer';

test.describe('HTTP control interface', () => {
  let electronApp: ElectronApplication;
  let context: BrowserContext;
  let serverState: ServerState;
  let page: Page;
  let appPath: string;

  async function doRequest(path: string, body = '', method = 'GET') {
    const url = `http://127.0.0.1:${ serverState.port }/${ path.replace(/^\/*/, '') }`;
    const auth = `${ serverState.user }:${ serverState.password }`;
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Basic ${ Buffer.from(auth)
          .toString('base64') }`
      },
    };

    if (body) {
      init.body = body;
    }

    return await fetch(url, init);
  }

  function rdctlPath() {
    return path.join(appPath, 'resources', os.platform(), 'bin', 'rdctl');
  }

  async function rdctl(commandArgs: string[]): Promise< { stdout: string, stderr: string }> {
    const rPath = rdctlPath();

    try {
      const {
        stdout,
        stderr
      } = await spawnFile(rPath, commandArgs, { stdio: 'pipe' });

      return {
        stdout,
        stderr
      };
    } catch (err) {
      console.log(`error: ${ err }`);

      return { stdout: '', stderr: '' };
    }
  }

  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async() => {
    createDefaultSettings();
    appPath = path.join(__dirname, '../');

    electronApp = await _electron.launch({
      args: [
        appPath,
        '--disable-gpu',
        '--whitelisted-ips=',
        '--disable-dev-shm-usage',
      ]
    });
    context = electronApp.context();

    await context.tracing.start({
      screenshots: true,
      snapshots:   true
    });
    page = await electronApp.firstWindow();
  });

  test.afterAll(async() => {
    await context.tracing.stop({ path: playwrightReportAssets(path.basename(__filename)) });
    await electronApp.close();
  });

  test('should load Kubernetes API', async() => {
    const navPage = new NavPage(page);

    await navPage.progressBecomesReady();
    await expect(navPage.progressBar).toBeHidden();

    expect(await kubectl('cluster-info')).toContain('is running at');
  });

  test('should emit connection information', async() => {
    const dataPath = path.join(paths.appHome, 'rd-engine.json');
    const dataRaw = await fs.promises.readFile(dataPath, 'utf-8');

    serverState = JSON.parse(dataRaw);
    expect(typeof serverState.user).toBe('string');
    expect(typeof serverState.password).toBe('string');
    expect(typeof serverState.port).toBe('number');
    expect(typeof serverState.pid).toBe('number');
  });

  test('should require authentication', async() => {
    const url = `http://127.0.0.1:${ serverState.port }/v0/list-settings`;
    const resp = await fetch(url);

    expect(resp.ok).toBeFalsy();
    expect(resp.status).toEqual(401);
  });

  test('should be able to get settings', async() => {
    const resp = await doRequest('/v0/list-settings');

    expect(resp.ok).toBeTruthy();
    expect(await resp.json()).toHaveProperty('kubernetes');
  });

  test('setting existing settings should be a no-op', async() => {
    let resp = await doRequest('/v0/list-settings');
    const rawSettings = resp.body.read().toString();

    resp = await doRequest('/v0/set', rawSettings, 'PUT');
    expect(resp.ok).toBeTruthy();
    expect(resp.status).toEqual(202);
    expect(resp.body.read().toString()).toContain('no changes necessary');
  });

  test('should not update values when the /set payload has errors', async() => {
    let resp = await doRequest('/v0/list-settings');
    const settings = await resp.json();
    const desiredEnabled = !settings.kubernetes.enabled;
    const desiredEngine = settings.kubernetes.containerEngine === 'moby' ? 'containerd' : 'moby';
    const desiredVersion = /1.23.4/.test(settings.kubernetes.version) ? 'v1.19.1' : 'v1.23.4';
    const requestedSettings = _.merge({}, settings, {
      kubernetes:
        {
          enabled:                    desiredEnabled,
          containerEngine:            desiredEngine,
          version:                    desiredVersion,
          checkForExistingKimBuilder: !settings.kubernetes.checkForExistingKimBuilder, // not supported
        }
    });
    const resp2 = await doRequest('/v0/set', JSON.stringify(requestedSettings), 'PUT');

    expect(resp2.ok).toBeFalsy();
    expect(resp2.status).toEqual(400);

    // Now verify that the specified values did not get updated.
    resp = await doRequest('/v0/list-settings');
    const refreshedSettings = await resp.json();

    expect(refreshedSettings).toEqual(settings);
  });

  test('should return multiple error messages', async() => {
    const newSettings: Record<string, any> = {
      kubernetes:     {
        WSLIntegrations: "ceci n'est pas un objet",
        stoinks:         'yikes!', // should be ignored
        memoryInGB:      'carl',
        containerEngine: { status: 'should be a scalar' },
      },
      portForwarding: 'bob',
      telemetry:      { oops: 15 }
    };
    const resp2 = await doRequest('/v0/set', JSON.stringify(newSettings), 'PUT');

    expect(resp2.ok).toBeFalsy();
    expect(resp2.status).toEqual(400);
    const body = resp2.body.read().toString();
    const expectedLines = [
      "Proposed field kubernetes.WSLIntegrations should be an object, got <ceci n'est pas un objet>.",
      "Changing field kubernetes.memoryInGB via the API isn't supported",
      'Setting kubernetes.containerEngine should be a simple value, but got <{"status":"should be a scalar"}>.',
      'Setting portForwarding should wrap an inner object, but got <bob>.',
      'Setting telemetry should be a simple value, but got <{"oops":15}>.',
    ];

    for (const line of expectedLines) {
      expect(body).toContain(line);
    }
  });

  test('should reject invalid JSON', async() => {
    const resp = await doRequest('/v0/set', '{"missing": "close-brace"', 'PUT');

    expect(resp.ok).toBeFalsy();
    expect(resp.status).toEqual(400);
    const body = resp.body.read().toString();

    expect(body).toContain('error processing JSON request block');
  });

  test('should reject empty payload', async() => {
    const resp = await doRequest('/v0/set', '', 'PUT');

    expect(resp.ok).toBeFalsy();
    expect(resp.status).toEqual(400);
    const body = resp.body.read().toString();

    expect(body).toContain('no settings specified in the request');
  });

  test.describe('rdctl', () => {
    test('should show settings and nil-update settings', async() => {
      const { stdout, stderr } = await rdctl(['list-settings']);

      expect(stderr).toEqual('');
      expect(stdout).toMatch(/"kubernetes":/);
      const settings = JSON.parse(stdout);

      expect(['version', 'kubernetes', 'portForwarding', 'images', 'telemetry', 'updater', 'debug']).toMatchObject(Object.keys(settings));

      const args = ['set', '--container-engine', settings.kubernetes.containerEngine,
        `--kubernetes-enabled=${ settings.kubernetes.enabled ? 'true' : 'false' }`,
        '--kubernetes-version', settings.kubernetes.version];
      const result = await rdctl(args);

      expect(result.stderr).toEqual('');
      expect(result.stdout).toContain('Status: no changes necessary.');
    });
  });

  // Where is the test that pushes a supported update, you may be wondering?
  // The problem with a positive test is that it needs to restart the backend. The UI disappears
  // but the various back-end processes, as well as playwright, are still running.
  // This kind of test would be better done as a standalone BAT-type test that can monitor
  // the processes. Meanwhile the unit tests verify that a valid payload should lead to an update.

  // Also there's no test checking for oversize-payload detection because when I try to create a
  // payload > 2000 characters I get this error:
  // FetchError: request to http://127.0.0.1:6107/v0/set failed, reason: socket hang up
});
