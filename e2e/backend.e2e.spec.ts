import fs from 'fs';
import os from 'os';
import path from 'path';

import _ from 'lodash';
import { ElectronApplication, BrowserContext, _electron, Page } from 'playwright';
import { test, expect } from '@playwright/test';

import { createDefaultSettings, packageLogs, reportAsset } from './utils/TestUtils';
import { NavPage } from './pages/nav-page';
import { Settings, ContainerEngine } from '@/config/settings';
import fetch from '@/utils/fetch';
import paths from '@/utils/paths';
import { RecursivePartial } from '@/utils/typeUtils';

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

    /**
     * getOldSettings returns the subset of oldSettings that also occur in
     * newSettings.  This can be used to revert the changes caused by newSettings.
     * @param oldSettings The settings that is a superset of the things to return.
     * @param newSettings The set that will determine what will be returned.
     */
    function getOldSettings(oldSettings: Settings, newSettings: RecursivePartial<Settings>): RecursivePartial<Settings> {
      const getOldSettingsSubset = <S>(oldObj: S, newObj: RecursivePartial<S>) => {
        const result: RecursivePartial<S> = {};

        for (const key of Object.keys(newObj) as (keyof S)[]) {
          const child = newObj[key];

          if (typeof child === 'object' && child !== null) {
            const nonNullChild: RecursivePartial<S[keyof S]> = child as any;

            result[key] = getOldSettingsSubset(oldObj[key], nonNullChild) as any;
          } else {
            result[key] = oldObj[key] as any;
          }
        }

        return result;
      };

      return getOldSettingsSubset(oldSettings, newSettings);
    }

    async function putSettings(newSettings: RecursivePartial<Settings>) {
      const auth = Buffer.from(`${ serverState.user }:${ serverState.password }`).toString('base64');
      const result = await fetch(`http://127.0.0.1:${ serverState.port }/v0/settings`, {
        body:    JSON.stringify(newSettings),
        headers: { Authorization: `basic ${ auth }` },
        method:  'PUT',
      });

      expect(result).toEqual(expect.objectContaining({ ok: true }));
    }

    test('should not have any reasons to restart', async() => {
      await expect(get('/v0/test_backend_restart_reasons')).resolves.toEqual({});
    });

    test('should detect changes', async() => {
      const currentSettings = (await get('/v0/settings')) as Settings;
      /**
       * getAlt returns the setting that isn't the same as the existing setting.
       */
      const getAlt = <K extends keyof KubeSettings>(setting: K, altOne: KubeSettings[K], altTwo: KubeSettings[K]) => {
        return currentSettings.kubernetes[setting] === altOne ? altTwo : altOne;
      };
      const getAlt2 = <K1 extends keyof KubeSettings, K2 extends keyof KubeSettings[K1]>(k1: K1, k2: K2, altOne: KubeSettings[K1][K2], altTwo: KubeSettings[K1][K2]) => {
        return currentSettings.kubernetes[k1][k2] === altOne ? altTwo : altOne;
      };
      const newSettings: RecursivePartial<Settings> = {
        kubernetes: {
          version:                  getAlt('version', '1.23.6', '1.23.5'),
          port:                     getAlt('port', 6443, 6444),
          containerEngine:          getAlt('containerEngine', ContainerEngine.CONTAINERD, ContainerEngine.MOBY),
          enabled:                  getAlt('enabled', true, false),
          options:                  {
            traefik: getAlt2('options', 'traefik', true, false),
            flannel: getAlt2('options', 'flannel', true, false),
          }
        }
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
      const oldSettings = getOldSettings(currentSettings, newSettings);
      const buildExpected = <K extends keyof Settings['kubernetes']>(setting: K, visible = false) => {
        return {
          current: currentSettings.kubernetes[setting],
          desired: newSettings.kubernetes?.[setting],
          visible,
        };
      };
      const buildExpected2 = <K1 extends keyof KubeSettings, K2 extends keyof KubeSettings[K1]>(k1: K1, k2: K2, visible = false) => {
        return {
          current: currentSettings.kubernetes[k1][k2],
          desired: (newSettings.kubernetes as KubeSettings)[k1][k2],
          visible
        };
      };
      const expected = {
        version:           buildExpected('version'),
        port:              buildExpected('port'),
        containerEngine:   buildExpected('containerEngine'),
        enabled:           buildExpected('enabled'),
        'options.traefik': buildExpected2('options', 'traefik'),
        'options.flannel': buildExpected2('options', 'flannel'),
      };

      if (os.platform() === 'win32') {
        _.merge(expected, { 'host-resolver': buildExpected('hostResolver') });
      } else {
        _.merge(expected, {
          sudo:   buildExpected('suppressSudo'),
          cpu:    buildExpected('numberCPUs', true),
          memory: buildExpected('memoryInGB', true),
        });
      }

      // We should never attempt to modify the top-level version, because it
      // cannot be set via the API, so it's a good test for getOldVersion().
      expect(oldSettings).not.toEqual(expect.objectContaining({ version: expect.anything() }));
      expect(oldSettings).toEqual(expect.objectContaining({ kubernetes: expect.any(Object) }));
      await expect(putSettings(newSettings)).resolves.toBeUndefined();
      try {
        await expect(get('/v0/test_backend_restart_reasons')).resolves.toEqual(expected);
      } finally {
        await expect(putSettings(oldSettings)).resolves.toBeUndefined();
      }
    });

    test('should handle WSL integrations', async() => {
      test.skip(os.platform() !== 'win32', 'WSL integration only supported on Windows');
      const currentSettings = (await get('/v0/settings')) as Settings;
      const random = `${ Date.now() }${ Math.random() }`;
      const newSettings: RecursivePartial<Settings> = {
        kubernetes: {
          WSLIntegrations: {
            [`true-${ random }`]:  true,
            [`false-${ random }`]: false,
          }
        }
      };

      await expect(putSettings(newSettings)).resolves.toBeUndefined();
      try {
        await expect(get('/v0/test_backend_restart_reasons')).resolves.toMatchObject({
          WSLIntegrations: {
            current: {},
            desired: newSettings.kubernetes?.WSLIntegrations,
            visible: false,
          }
        });
      } finally {
        await expect(putSettings(getOldSettings(currentSettings, newSettings))).resolves.toBeUndefined();
      }
    });
  });
});
