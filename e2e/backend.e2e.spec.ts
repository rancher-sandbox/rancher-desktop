import fs from 'fs';
import os from 'os';
import path from 'path';

import { test, expect } from '@playwright/test';
import _ from 'lodash';
import { ElectronApplication, BrowserContext, _electron, Page } from 'playwright';
import semver from 'semver';

import { NavPage } from './pages/nav-page';
import { createDefaultSettings, packageLogs, reportAsset } from './utils/TestUtils';

import { Settings, ContainerEngine } from '@/config/settings';
import fetch from '@/utils/fetch';
import paths from '@/utils/paths';
import { RecursivePartial, RecursiveKeys, RecursiveTypes } from '@/utils/typeUtils';

type KubeSettings = Settings['kubernetes'];

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
        // See src/utils/commandLine.ts before changing the next item as the final option.
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

      return await result.json();
    }

    test('should detect changes', async() => {
      const currentSettings = (await get('/v0/settings')) as Settings;
      /**
       * getAlt returns the setting that isn't the same as the existing setting.
       */
      const getAlt = <K extends keyof RecursiveTypes<KubeSettings>>(setting: K, altOne: RecursiveTypes<KubeSettings>[K], altTwo: RecursiveTypes<KubeSettings>[K]) => {
        return _.get(currentSettings.kubernetes, setting) === altOne ? altTwo : altOne;
      };
      const newSettings: RecursivePartial<Settings> = {
        kubernetes: {
          version:                  getAlt('version', '1.23.6', '1.23.5'),
          port:                     getAlt('port', 6443, 6444),
          containerEngine:          getAlt('containerEngine', ContainerEngine.CONTAINERD, ContainerEngine.MOBY),
          enabled:                  getAlt('enabled', true, false),
          options:                  {
            traefik: getAlt('options.traefik', true, false),
            flannel: getAlt('options.flannel', true, false),
          },
        },
      };
      const platformSettings: Record<string, RecursivePartial<Settings>> = {
        win32: { kubernetes: { hostResolver: getAlt('hostResolver', true, false) } },
        lima:  {
          kubernetes: {
            numberCPUs:   getAlt('numberCPUs', 1, 2),
            memoryInGB:   getAlt('memoryInGB', 3, 4),
            suppressSudo: getAlt('suppressSudo', true, false),
          },
        },
      };

      _.merge(newSettings, platformSettings[os.platform() === 'win32' ? 'win32' : 'lima']);

      const expectedDefinition: Partial<Record<RecursiveKeys<Settings['kubernetes']>, boolean>> = {
        version:           semver.lt(newSettings.kubernetes?.version ?? '0.0.0', currentSettings.kubernetes.version),
        port:              false,
        containerEngine:   false,
        enabled:           false,
        'options.traefik': false,
        'options.flannel': false,
      };

      if (os.platform() === 'win32') {
        expectedDefinition.hostResolver = false;
      } else {
        expectedDefinition.suppressSudo = false;
        expectedDefinition.numberCPUs = false;
        expectedDefinition.memoryInGB = false;
      }

      const expected: Record<string, {current: any, desired: any, severity: 'reset' | 'restart'}> = {};

      for (const [partialKey, reset] of Object.entries(expectedDefinition)) {
        const key = `kubernetes.${ partialKey }`;
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
