import fs from 'fs';
import os from 'os';
import path from 'path';

import { test, expect } from '@playwright/test';
import _ from 'lodash';
import { ElectronApplication, BrowserContext, _electron, Page } from 'playwright';
import semver from 'semver';

import { NavPage } from './pages/nav-page';
import { createDefaultSettings, packageLogs, reportAsset } from './utils/TestUtils';

import { Settings, ContainerEngine } from '@pkg/config/settings';
import fetch from '@pkg/utils/fetch';
import paths from '@pkg/utils/paths';
import { RecursivePartial, RecursiveKeys, RecursiveTypes } from '@pkg/utils/typeUtils';

import type { GetFieldType } from 'lodash';

test.describe.serial('KubernetesBackend', () => {
  let electronApp: ElectronApplication;
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async() => {
    createDefaultSettings();

    electronApp = await _electron.launch({
      args: [
        path.join(__dirname, '../'),
        '--disable-gpu',
        '--whitelisted-ips=',
        // See pkg/rancher-desktop/utils/commandLine.ts before changing the next item as the final option.
        '--disable-dev-shm-usage',
        '--no-modal-dialogs',
      ],
      env: {
        ...process.env,
        RD_LOGS_DIR: reportAsset(__filename, 'log'),
      },
    });
    context = electronApp.context();

    await context.tracing.start({ screenshots: true, snapshots: true });
    page = await electronApp.firstWindow();
  });

  test.afterAll(async() => {
    await context.tracing.stop({ path: reportAsset(__filename) });
    await packageLogs(__filename);
    await electronApp.close();
  });

  test('should start loading the background services and hide progress bar', async() => {
    const navPage = new NavPage(page);

    await navPage.progressBecomesReady();
    await expect(navPage.progressBar).toBeHidden();
  });

  test.describe('requiresRestartReasons', () => {
    let serverState: { user: string, password: string, port: string, pid: string };

    test.afterEach(async() => {
      // Wait for the backend to stop (it's okay to fail to start here though)
      const navPage = new NavPage(page);

      while (await navPage.progressBar.count() > 0) {
        await navPage.progressBar.waitFor({ state: 'detached', timeout: 120_000 });
      }
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

    async function get(requestPath: string) {
      const auth = Buffer.from(`${ serverState.user }:${ serverState.password }`).toString('base64');
      const result = await fetch(`http://127.0.0.1:${ serverState.port }/${ requestPath.replace(/^\//, '') }`, { headers: { Authorization: `basic ${ auth }` } });

      expect(result).toEqual(expect.objectContaining({ ok: true }));

      return await result.json();
    }

    async function put(requestPath: string, body: any) {
      const auth = Buffer.from(`${ serverState.user }:${ serverState.password }`).toString('base64');
      const result = await fetch(`http://127.0.0.1:${ serverState.port }/${ requestPath.replace(/^\//, '') }`, {
        body:    JSON.stringify(body),
        headers: { Authorization: `basic ${ auth }` },
        method:  'PUT',
      });
      const text = await result.text();

      try {
        return JSON.parse(text);
      } catch (ex) {
        throw new Error(`Response text is not JSON: \n${ text }`);
      }
    }

    test('should detect changes', async() => {
      const currentSettings = (await get('/v0/settings')) as Settings;
      /**
       * getAlt returns the setting that isn't the same as the existing setting.
       */
      const getAlt = <K extends keyof RecursiveTypes<Settings>>(setting: K, altOne: GetFieldType<Settings, K>, altTwo: GetFieldType<Settings, K>) => {
        return _.get(currentSettings, setting) === altOne ? altTwo : altOne;
      };

      const newSettings: RecursivePartial<Settings> = {
        kubernetes: {
          version:         getAlt('kubernetes.version', '1.23.6', '1.23.5'),
          port:            getAlt('kubernetes.port', 6443, 6444),
          containerEngine: getAlt('kubernetes.containerEngine', ContainerEngine.CONTAINERD, ContainerEngine.MOBY),
          enabled:         getAlt('kubernetes.enabled', true, false),
          options:         {
            traefik: getAlt('kubernetes.options.traefik', true, false),
            flannel: getAlt('kubernetes.options.flannel', true, false),
          },
        },
      };
      /** Platform-specific changes to `newSettings`. */
      const platformSettings: Partial<Record<NodeJS.Platform, RecursivePartial<Settings>>> = {
        win32:  { kubernetes: { hostResolver: getAlt('kubernetes.hostResolver', true, false) } },
        darwin: { kubernetes: { experimental: { socketVMNet: getAlt('kubernetes.experimental.socketVMNet', true, false) } } },
      };

      _.merge(newSettings, platformSettings[process.platform] ?? {});
      if (['darwin', 'linux'].includes(process.platform)) {
        // Lima-specific changes to `newSettings`.
        _.merge(newSettings, {
          kubernetes: {
            numberCPUs:   getAlt('kubernetes.numberCPUs', 1, 2),
            memoryInGB:   getAlt('kubernetes.memoryInGB', 3, 4),
            suppressSudo: getAlt('kubernetes.suppressSudo', true, false),
          },
        });
      }

      /**
       * Helper type; an (incomplete) mapping where the key is the preference
       * name, and the value is a boolean value indicating whether reset is needed.
       */
      type ExpectedDefinition = Partial<Record<RecursiveKeys<Settings>, boolean>>;

      const expectedDefinition: ExpectedDefinition = {
        'kubernetes.version':         semver.lt(newSettings.kubernetes?.version ?? '0.0.0', currentSettings.kubernetes.version),
        'kubernetes.port':            false,
        'kubernetes.containerEngine': false,
        'kubernetes.enabled':         false,
        'kubernetes.options.traefik': false,
        'kubernetes.options.flannel': false,
      };

      /** Platform-specific additions to `expectedDefinition`. */
      const platformExpectedDefinitions: Partial<Record<NodeJS.Platform, ExpectedDefinition>> = {
        win32:  { 'kubernetes.hostResolver': false },
        darwin: { 'kubernetes.experimental.socketVMNet': false },
      };

      _.merge(expectedDefinition, platformExpectedDefinitions[process.platform] ?? {});

      if (['darwin', 'linux'].includes(process.platform)) {
        // Lima additions to expectedDefinition
        expectedDefinition['kubernetes.suppressSudo'] = false;
        expectedDefinition['kubernetes.numberCPUs'] = false;
        expectedDefinition['kubernetes.memoryInGB'] = false;
      }

      const expected: Record<string, {current: any, desired: any, severity: 'reset' | 'restart'}> = {};

      for (const [key, reset] of Object.entries(expectedDefinition)) {
        const entry = {
          current:  _.get(currentSettings, key),
          desired:  _.get(newSettings, key),
          severity: reset ? 'reset' : 'restart' as 'reset' | 'restart',
        };

        expected[key] = entry;
      }

      await expect(put('/v0/propose_settings', newSettings)).resolves.toEqual(expected);
    });

    test('should handle WSL integrations', async() => {
      test.skip(os.platform() !== 'win32', 'WSL integration only supported on Windows');
      const random = `${ Date.now() }${ Math.random() }`;
      const newSettings: RecursivePartial<Settings> = {
        kubernetes: {
          WSLIntegrations: {
            [`true-${ random }`]:  true,
            [`false-${ random }`]: false,
          },
        },
      };

      await expect(put('/v0/propose_settings', newSettings)).resolves.toMatchObject({
        'kubernetes.WSLIntegrations': {
          current: {},
          desired: newSettings.kubernetes?.WSLIntegrations,
        },
      });
    });
  });
});
