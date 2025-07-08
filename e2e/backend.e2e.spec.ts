import fs from 'fs';
import os from 'os';
import path from 'path';

import { test, expect } from '@playwright/test';
import _ from 'lodash';
import semver from 'semver';

import { NavPage } from './pages/nav-page';
import { getAlternateSetting, startSlowerDesktop, teardown } from './utils/TestUtils';

import { Settings, ContainerEngine, VMType, MountType } from '@pkg/config/settings';
import fetch from '@pkg/utils/fetch';
import paths from '@pkg/utils/paths';
import { RecursivePartial, RecursiveKeys } from '@pkg/utils/typeUtils';

import type { ElectronApplication, Page } from '@playwright/test';

test.describe.serial('KubernetesBackend', () => {
  let electronApp: ElectronApplication;
  let page: Page;

  test.beforeAll(async({ colorScheme }, testInfo) => {
    [electronApp, page] = await startSlowerDesktop(testInfo, {
      virtualMachine: {
        mount: {
          type: MountType.REVERSE_SSHFS,
        }
      }
    });
  });

  test.afterAll(({ colorScheme }, testInfo) => teardown(electronApp, testInfo));

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
      const currentSettings = (await get('/v1/settings')) as Settings;

      if (!currentSettings.kubernetes.version) {
        // The Kubernetes version could be empty if it's previously disabled.
        // Set something.
        const updatedSettings: RecursivePartial<Settings> = {
          kubernetes: { version: '1.29.4' },
          version:    10 as Settings['version'],
        };

        await expect(put('/v1/settings', updatedSettings)).resolves.toBeDefined();
      }

      const newSettings: RecursivePartial<Settings> = {
        containerEngine: { name: getAlternateSetting(currentSettings, 'containerEngine.name', ContainerEngine.CONTAINERD, ContainerEngine.MOBY) },
        kubernetes:      {
          version: getAlternateSetting(currentSettings, 'kubernetes.version', '1.29.6', '1.29.5'),
          port:    getAlternateSetting(currentSettings, 'kubernetes.port', 6443, 6444),
          enabled: getAlternateSetting(currentSettings, 'kubernetes.enabled', true, false),
          options: {
            traefik: getAlternateSetting(currentSettings, 'kubernetes.options.traefik', true, false),
            flannel: getAlternateSetting(currentSettings, 'kubernetes.options.flannel', true, false),
          },
        },
      };
      /** Platform-specific changes to `newSettings`. */
      const platformSettings: Partial<Record<NodeJS.Platform, RecursivePartial<Settings>>> = {
        win32:  { kubernetes: { ingress: { localhostOnly: getAlternateSetting(currentSettings, 'kubernetes.ingress.localhostOnly', true, false) } } },
        darwin: { virtualMachine: { type: getAlternateSetting(currentSettings, 'virtualMachine.type', VMType.VZ, VMType.QEMU) } },
      };

      _.merge(newSettings, platformSettings[process.platform] ?? {});
      if (['darwin', 'linux'].includes(process.platform)) {
        // Lima-specific changes to `newSettings`.
        _.merge(newSettings, {
          virtualMachine: {
            numberCPUs: getAlternateSetting(currentSettings, 'virtualMachine.numberCPUs', 1, 2),
            memoryInGB: getAlternateSetting(currentSettings, 'virtualMachine.memoryInGB', 3, 4),
          },
          application: { adminAccess: getAlternateSetting(currentSettings, 'application.adminAccess', false, true) },
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
        'containerEngine.name':       false,
        'kubernetes.enabled':         false,
        'kubernetes.options.traefik': false,
        'kubernetes.options.flannel': false,
      };

      /** Platform-specific additions to `expectedDefinition`. */
      const platformExpectedDefinitions: Partial<Record<NodeJS.Platform, ExpectedDefinition>> = {
        win32:  { 'kubernetes.ingress.localhostOnly': false },
        darwin: { 'virtualMachine.type': false },
      };

      _.merge(expectedDefinition, platformExpectedDefinitions[process.platform] ?? {});

      if (['darwin', 'linux'].includes(process.platform)) {
        // Lima additions to expectedDefinition
        expectedDefinition['application.adminAccess'] = false;
        expectedDefinition['virtualMachine.numberCPUs'] = false;
        expectedDefinition['virtualMachine.memoryInGB'] = false;
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

      await expect(put('/v1/propose_settings', newSettings)).resolves.toEqual(expected);
    });

    test('should handle WSL integrations', async() => {
      test.skip(os.platform() !== 'win32', 'WSL integration only supported on Windows');
      const random = `${ Date.now() }${ Math.random() }`;
      const newSettings: RecursivePartial<Settings> = {
        WSL: {
          integrations: {
            [`true-${ random }`]:  true,
            [`false-${ random }`]: false,
          },
        },
      };

      await expect(put('/v1/propose_settings', newSettings)).resolves.toMatchObject({
        'WSL.integrations': {
          desired:  newSettings.WSL?.integrations,
          severity: 'restart',
        },
      });
    });
  });
});
