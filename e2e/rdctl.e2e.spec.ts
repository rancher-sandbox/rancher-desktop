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

import { expect, test } from '@playwright/test';
import { BrowserContext, ElectronApplication, Page, _electron } from 'playwright';

import fetch, { RequestInit } from 'node-fetch';
import _ from 'lodash';
import { createDefaultSettings, kubectl, playwrightReportAssets } from './utils/TestUtils';
import { NavPage } from './pages/nav-page';
import paths from '@/utils/paths';
import { ServerState } from '@/main/commandServer/httpCommandServer';
import * as settings from '@/config/settings';
import { RecursivePartial } from '@/utils/recursivePartialType';

test.describe('HTTP control interface', () => {
  let electronApp: ElectronApplication;
  let context: BrowserContext;
  let serverState: ServerState;
  let page: Page;

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

  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async() => {
    createDefaultSettings();

    electronApp = await _electron.launch({
      args: [
        path.join(__dirname, '../'),
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
    const rawSettings = (await resp.body).read().toString();

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
          checkForExistingKimBuilder: !settings.kubernetes.checkForExistingKimBuilder,
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

  test('complains about readonly fields', async() => {
    const resp = await doRequest('/v0/list-settings');
    const settings = await resp.json();

    const valuesToChange: [RecursivePartial<settings.Settings>, string][] = [
      [{ version: settings.version + 1 }, 'version'],
      [{ kubernetes: { memoryInGB: settings.kubernetes.memoryInGB + 1 } }, 'kubernetes.memoryInGB'],
      [{ kubernetes: { numberCPUs: settings.kubernetes.numberCPUs + 1 } }, 'kubernetes.numberCPUs'],
      [{ kubernetes: { port: settings.kubernetes.port + 1 } }, 'kubernetes.port'],
      [{ kubernetes: { checkForExistingKimBuilder: !settings.kubernetes.checkForExistingKimBuilder } }, 'kubernetes.checkForExistingKimBuilder'],
      [{ kubernetes: { WSLIntegrations: { stuff: 'here' } } }, 'kubernetes.WSLIntegrations'],
      [{ kubernetes: { options: { traefik: !settings.kubernetes.options.traefik } } }, 'kubernetes.options.traefik'],
      [{ portForwarding: { includeKubernetesServices: !settings.portForwarding.includeKubernetesServices } }, 'portForwarding.includeKubernetesServices'],
      [{ images: { showAll: !settings.images.showAll } }, 'images.showAll'],
      [{ images: { namespace: '*gorniplatz*' } }, 'images.namespace'],
      [{ telemetry: !settings.telemetry }, 'telemetry'],
      [{ updater: !settings.updater }, 'updater'],
      [{ debug: !settings.debug }, 'debug'],
    ];

    for (const [specifiedSettingSegment, fullQualifiedPreferenceName] of valuesToChange) {
      const newSettings = _.merge({}, settings, specifiedSettingSegment);
      const resp2 = await doRequest('/v0/set', JSON.stringify(newSettings), 'PUT');

      expect(resp2.ok).toBeFalsy();
      expect(resp2.status).toEqual(400);
      expect(resp2.body.read().toString()).toContain(`Changing field ${ fullQualifiedPreferenceName } via the API isn't supported.`);
    }
  });

  test('complains about invalid fields', async() => {
    const resp = await doRequest('/v0/list-settings');
    const newSettings = await resp.json();
    const version = newSettings.kubernetes.version;
    const engine = newSettings.kubernetes.containerEngine;

    newSettings.kubernetes.version = 'v1.0.0';
    let resp2 = await doRequest('/v0/set', JSON.stringify(newSettings), 'PUT');

    expect(resp2.ok).toBeFalsy();
    expect(resp2.status).toEqual(400);
    expect(resp2.body.read().toString())
      .toContain(`Kubernetes version ${ newSettings.kubernetes.version.substring(1) } not found.`);

    newSettings.kubernetes.version = version;
    newSettings.kubernetes.containerEngine = 'dracula';
    resp2 = await doRequest('/v0/set', JSON.stringify(newSettings), 'PUT');
    expect(resp2.ok).toBeFalsy();
    expect(resp2.status).toEqual(400);
    expect(resp2.body.read().toString())
      .toContain(`Invalid value for kubernetes.containerEngine: <${ newSettings.kubernetes.containerEngine }>; must be 'containerd', 'docker', or 'moby'`);

    newSettings.kubernetes.containerEngine = engine;
    newSettings.kubernetes.enabled = 'do you want fries with that?';
    resp2 = await doRequest('/v0/set', JSON.stringify(newSettings), 'PUT');
    expect(resp2.ok).toBeFalsy();
    expect(resp2.status).toEqual(400);
    expect(resp2.body.read().toString())
      .toContain(`Invalid value for kubernetes.enabled: <${ newSettings.kubernetes.enabled }>`);
  });

  test('complains about mismatches between objects and scalars', async() => {
    const newSettings: Record<string, any> = { kubernetes: 5 };
    let resp2 = await doRequest('/v0/set', JSON.stringify(newSettings), 'PUT');

    expect(resp2.ok).toBeFalsy();
    expect(resp2.status).toEqual(400);
    expect(resp2.body.read().toString())
      .toContain('Setting kubernetes should wrap an inner object, but got <5>');

    newSettings.kubernetes = { containerEngine: { expected: 'a string' } };
    resp2 = await doRequest('/v0/set', JSON.stringify(newSettings), 'PUT');
    expect(resp2.ok).toBeFalsy();
    expect(resp2.status).toEqual(400);
    expect(resp2.body.read().toString())
      .toContain('Setting kubernetes.containerEngine should be a simple value, but got <{"expected":"a string"}>');

    // Special-case of an error message: the code doesn't detect that the proposed value isn't actually an
    // object, because it doesn't need to yet.
    newSettings.kubernetes = { WSLIntegrations: "ceci n'est pas un objet" };
    resp2 = await doRequest('/v0/set', JSON.stringify(newSettings), 'PUT');
    expect(resp2.ok).toBeFalsy();
    expect(resp2.status).toEqual(400);
    expect(resp2.body.read().toString())
      .toContain(`Proposed field kubernetes.WSLIntegrations should be an object, got <${ newSettings.kubernetes.WSLIntegrations }>`);
  });

  test('should return multiple error messages', async() => {
    const newSettings: Record<string, any> = {
      kubernetes:     {
        WSLIntegrations: "ceci n'est pas un objet",
        stoinks:         'yikes!',
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
      "Setting name kubernetes.stoinks isn't recognized.",
      "Changing field kubernetes.memoryInGB via the API isn't supported",
      'Setting kubernetes.containerEngine should be a simple value, but got <{"status":"should be a scalar"}>.',
      'Setting portForwarding should wrap an inner object, but got <bob>.',
      'Setting telemetry should be a simple value, but got <{"oops":15}>.',
    ];

    for (const line of expectedLines) {
      expect(body).toContain(line);
    }
  });

  // Where is the test that pushes a supported update, you may be wondering?
  // The problem with a positive test is that it needs to restart the backend. The UI disappears
  // but the various back-end processes, as well as playwright, are still running.
  // This kind of test would be better done as a standalone BAT-type test that can monitor
  // the processes.
});
