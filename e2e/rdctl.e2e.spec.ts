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

import { expect, test } from '@playwright/test';
import _ from 'lodash';
import fetch from 'node-fetch';
import yaml from 'yaml';

import { NavPage } from './pages/nav-page';
import {
  getAlternateSetting, kubectl, retry, startSlowerDesktop, teardown,
} from './utils/TestUtils';

import {
  CacheMode,
  ContainerEngine,
  CURRENT_SETTINGS_VERSION,
  defaultSettings,
  MountType,
  ProtocolVersion,
  SecurityModel,
  Settings,
  VMType,
} from '@pkg/config/settings';
import { PathManagementStrategy } from '@pkg/integrations/pathManager';
import { ServerState } from '@pkg/main/commandServer/httpCommandServer';
import { spawnFile } from '@pkg/utils/childProcess';
import paths from '@pkg/utils/paths';
import { RecursivePartial } from '@pkg/utils/typeUtils';

import type { ElectronApplication, Page } from '@playwright/test';
import type { RequestInit } from 'node-fetch';

test.describe('Command server', () => {
  let electronApp: ElectronApplication;
  let serverState: ServerState;
  let page: Page;
  const ENOENTMessage = os.platform() === 'win32' ? 'The system cannot find the file specified' : 'no such file or directory';
  const appPath = path.dirname(import.meta.dirname);

  async function doRequest(path: string, body = '', method = 'GET') {
    const url = `http://127.0.0.1:${ serverState.port }/${ path.replace(/^\/*/, '') }`;
    const auth = `${ serverState.user }:${ serverState.password }`;
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Basic ${ Buffer.from(auth)
          .toString('base64') }`,
      },
    };

    if (body) {
      init.body = body;
    }

    return await fetch(url, init);
  }

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

  async function rdctlWithStdin(inputFile: string, commandArgs: string[]): Promise< { stdout: string, stderr: string, error?: any}> {
    let stream: fs.ReadStream | null = null;

    try {
      const fd = await fs.promises.open(inputFile, 'r');

      stream = fd.createReadStream();

      return await spawnFile(rdctlPath(), commandArgs, { stdio: [stream, 'pipe', 'pipe'] });
    } catch (err: any) {
      return {
        stdout: err?.stdout ?? '', stderr: err?.stderr ?? '', error: err,
      };
    } finally {
      stream?.close();
    }
  }

  function verifySettingsKeys(settings: Record<string, any>) {
    expect(new Set(Object.keys(defaultSettings)))
      .toEqual(new Set(Object.keys(settings)));
  }

  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async({ colorScheme }, testInfo) => {
    [electronApp, page] = await startSlowerDesktop(testInfo, { kubernetes: { enabled: true } });
  });

  test.afterAll(({ colorScheme }, testInfo) => teardown(electronApp, testInfo));

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

  test('should emit CORS headers, settings request', async() => {
    const resp = await doRequest('/v1/settings', '', 'OPTIONS');

    expect({
      ...resp,
      ok:      !!resp.ok,
      headers: Object.fromEntries(resp.headers.entries()),
    }).toEqual(expect.objectContaining({
      ok:      true,
      headers: expect.objectContaining({
        'access-control-allow-headers': 'Authorization',
        'access-control-allow-methods': 'GET, PUT, DELETE',
        'access-control-allow-origin':  '*',
      }),
    }));
  });

  test('should be able to get settings', async() => {
    const resp = await doRequest('/v1/settings');

    expect({
      ...resp,
      ok:      !!resp.ok,
      headers: Object.fromEntries(resp.headers.entries()),
    }).toEqual(expect.objectContaining({
      ok:      true,
      headers: expect.objectContaining({
        'access-control-allow-headers': 'Authorization',
        'access-control-allow-methods': 'GET, PUT, DELETE',
        'access-control-allow-origin':  '*',
      }),
    }));
    expect(await resp.json()).toHaveProperty('kubernetes');
  });

  test('setting existing settings should be a no-op', async() => {
    let resp = await doRequest('/v1/settings');
    const rawSettings = resp.body.read().toString();

    resp = await doRequest('/v1/settings', rawSettings, 'PUT');
    expect({
      ok:     resp.ok,
      status: resp.status,
      body:   resp.body.read().toString(),
    }).toEqual({
      ok:     true,
      status: 202,
      body:   expect.stringContaining('no changes necessary'),
    });
  });

  test('should not update values when the /settings payload has errors', async() => {
    let resp = await doRequest('/v1/settings');
    const settings = await resp.json();
    const desiredEnabled = !settings.kubernetes.enabled;
    const desiredEngine = 'flip';
    const desiredVersion = /1.29.4/.test(settings.kubernetes.version) ? 'v1.19.1' : 'v1.29.4';
    const requestedSettings = _.merge({}, settings, {
      version:         CURRENT_SETTINGS_VERSION,
      containerEngine: {
        name:          { desiredEngine },
        allowedImages: { enabled: !settings.containerEngine.allowedImages.enabled },
      },
      kubernetes: {
        enabled: desiredEnabled,
        version: desiredVersion,
      },
    });
    const resp2 = await doRequest('/v1/settings', JSON.stringify(requestedSettings), 'PUT');

    expect(resp2.ok).toBeFalsy();
    expect(resp2.status).toEqual(400);

    // Now verify that the specified values did not get updated.
    resp = await doRequest('/v1/settings');
    const refreshedSettings = await resp.json();

    expect(refreshedSettings).toEqual(settings);
  });

  test('should return multiple error messages, settings request', async() => {
    const newSettings: Record<string, any> = {
      version:     CURRENT_SETTINGS_VERSION,
      application: {
        stoinks:   'yikes!', // should be ignored
        telemetry: { enabled: { oops: 15 } },
      },
      containerEngine: { name: { status: 'should be a scalar' } },
      virtualMachine:  { memoryInGB: 'carl' },
      WSL:             { integrations: "ceci n'est pas un objet" },
      portForwarding:  'bob',
    };
    const resp2 = await doRequest('/v1/settings', JSON.stringify(newSettings), 'PUT');

    expect(resp2.ok).toBeFalsy();
    expect(resp2.status).toEqual(400);
    const body = resp2.body.read().toString();
    const expectedWSL = {
      win32: `Proposed field "WSL.integrations" should be an object, got <ceci n'est pas un objet>.`,
      lima:  `Changing field "WSL.integrations" via the API isn't supported.`,
    }[os.platform() === 'win32' ? 'win32' : 'lima'];
    const expectedMemory = {
      win32: `Changing field "virtualMachine.memoryInGB" via the API isn't supported.`,
      lima:  `Invalid value for "virtualMachine.memoryInGB": <"carl">`,
    }[os.platform() === 'win32' ? 'win32' : 'lima'];
    const expectedLines = [
      'errors in attempt to update settings:',
      expectedWSL,
      expectedMemory,
      `Invalid value for "containerEngine.name": <{\"status\":\"should be a scalar\"}>; must be one of ["containerd","moby","docker"]`,
      'Setting "portForwarding" should wrap an inner object, but got <bob>.',
      'Invalid value for "application.telemetry.enabled": <{"oops":15}>',
    ];

    expect(body.split(/\r?\n/g).sort()).toEqual(expect.arrayContaining(expectedLines.sort()));
  });

  test('should reject invalid JSON, settings request', async() => {
    const resp = await doRequest('/v1/settings', '{"missing": "close-brace"', 'PUT');

    expect(resp.ok).toBeFalsy();
    expect(resp.status).toEqual(400);
    const body = resp.body.read().toString();

    expect(body).toContain('error processing JSON request block');
  });

  test('should reject empty payload, settings request', async() => {
    const resp = await doRequest('/v1/settings', '', 'PUT');

    expect(resp.ok).toBeFalsy();
    expect(resp.status).toEqual(400);
    const body = resp.body.read().toString();

    expect(body).toContain('no settings specified in the request');
  });

  test('version-only path of a nonexistent version should 404', async() => {
    const resp = await doRequest('/v99bottlesofbeeronthewall');

    expect(resp.ok).toBeFalsy();
    expect(resp.status).toEqual(404);
    const body = resp.body.read().toString();

    expect(body).toContain('Unknown command: GET /v99bottlesofbeeronthewall');
  });

  test('should not restart on unrelated changes', async() => {
    let resp = await doRequest('/v1/settings');

    expect(resp.ok).toBeTruthy();
    const telemetry = (await resp.json() as Settings).application.telemetry.enabled;

    resp = await doRequest('/v1/settings', JSON.stringify({ version: CURRENT_SETTINGS_VERSION, application: { telemetry: { enabled: !telemetry } } }), 'PUT');
    expect(resp.ok).toBeTruthy();
    await expect(resp.text()).resolves.toContain('no restart required');
  });

  test('should complain about a missing version field', async() => {
    let resp = await doRequest('/v1/settings');

    expect(resp.ok).toBeTruthy();

    const body: RecursivePartial<Settings> = await resp.json();

    delete body.version;
    if (body?.application?.telemetry) {
      body.application.telemetry.enabled = !body.application.telemetry.enabled;
    }
    resp = await doRequest('/v1/settings', JSON.stringify(body), 'PUT');
    expect(resp.ok).toBeFalsy();
    await expect(resp.text()).resolves.toContain(`updating settings requires specifying an API version, but no version was specified`);
  });

  test('should complain about an invalid version field', async() => {
    let resp = await doRequest('/v1/settings');

    expect(resp.ok).toBeTruthy();

    const body: RecursivePartial<Settings> = await resp.json();
    const badVersion = 'not a number';

    // Override typescript's checking so we can verify that the server rejects the
    // invalid value for the `version` field.
    body.version = badVersion as any;
    if (body?.application?.telemetry) {
      body.application.telemetry.enabled = !body.application.telemetry.enabled;
    }
    resp = await doRequest('/v1/settings', JSON.stringify(body), 'PUT');
    expect(resp.ok).toBeFalsy();
    await expect(resp.text()).resolves.toContain(`updating settings requires specifying an API version, but "${ badVersion }" is not a proper config version`);
  });

  test('should require authentication, transient settings request', async() => {
    const url = `http://127.0.0.1:${ serverState.port }/v1/transient_settings`;
    const resp = await fetch(url);

    expect(resp).toEqual(expect.objectContaining({
      ok:     false,
      status: 401,
    }));
  });

  test('should emit CORS headers, transient settings request', async() => {
    const resp = await doRequest('/v1/transient_settings', '', 'OPTIONS');

    expect({
      ...resp,
      ok:      !!resp.ok,
      headers: Object.fromEntries(resp.headers.entries()),
    }).toEqual(expect.objectContaining({
      ok:      true,
      headers: expect.objectContaining({
        'access-control-allow-headers': 'Authorization',
        'access-control-allow-methods': 'GET, PUT, DELETE',
        'access-control-allow-origin':  '*',
      }),
    }));
  });

  test('should be able to get transient settings', async() => {
    const resp = await doRequest('/v1/transient_settings');

    expect({
      ...resp,
      ok:      !!resp.ok,
      headers: Object.fromEntries(resp.headers.entries()),
    }).toEqual(expect.objectContaining({
      ok:      true,
      headers: expect.objectContaining({
        'access-control-allow-headers': 'Authorization',
        'access-control-allow-methods': 'GET, PUT, DELETE',
        'access-control-allow-origin':  '*',
      }),
    }));
    expect(await resp.json()).toHaveProperty('noModalDialogs');
  });

  test('setting existing transient settings should be a no-op', async() => {
    let resp = await doRequest('/v1/transient_settings');
    const rawSettings = resp.body.read().toString();

    resp = await doRequest('/v1/transient_settings', rawSettings, 'PUT');
    expect({
      ok:     resp.ok,
      status: resp.status,
      body:   resp.body.read().toString(),
    }).toEqual({
      ok:     true,
      status: 202,
      body:   expect.stringContaining('No changes necessary'),
    });
  });

  test('should not update values when the /transient_settings navItem payload is invalid', async() => {
    let resp = await doRequest('/v1/transient_settings');
    const transientSettings = await resp.json();

    const requestedSettings = _.merge({}, transientSettings, { preferences: { navItem: { current: 'foo', bar: 'bar' } } });
    const resp2 = await doRequest('/v1/transient_settings', JSON.stringify(requestedSettings), 'PUT');

    expect(resp2.ok).toBeFalsy();
    expect(resp2.status).toEqual(400);

    // Now verify that the specified values did not get updated.
    resp = await doRequest('/v1/transient_settings');
    const refreshedSettings = await resp.json();

    expect(refreshedSettings).toEqual(transientSettings);
  });

  test('should not update values when the /transient_settings payload has invalid current navItem name', async() => {
    let resp = await doRequest('/v1/transient_settings');
    const transientSettings = await resp.json();

    const requestedSettings = _.merge({}, transientSettings, { preferences: { navItem: { current: 'foo' } } });
    const resp2 = await doRequest('/v1/transient_settings', JSON.stringify(requestedSettings), 'PUT');

    expect(resp2.ok).toBeFalsy();
    expect(resp2.status).toEqual(400);

    // Now verify that the specified values did not get updated.
    resp = await doRequest('/v1/transient_settings');
    const refreshedSettings = await resp.json();

    expect(refreshedSettings).toEqual(transientSettings);
  });

  test('should not update values when the /transient_settings payload has invalid sub-tabs for Application preference page', async() => {
    let resp = await doRequest('/v1/transient_settings');
    const transientSettings = await resp.json();

    const requestedSettings = _.merge({}, transientSettings, { preferences: { navItem: { current: 'Application', currentTabs: { Application: 'foo' } } } });
    const resp2 = await doRequest('/v1/transient_settings', JSON.stringify(requestedSettings), 'PUT');

    expect(resp2.ok).toBeFalsy();
    expect(resp2.status).toEqual(400);

    // Now verify that the specified values did not get updated.
    resp = await doRequest('/v1/transient_settings');
    const refreshedSettings = await resp.json();

    expect(refreshedSettings).toEqual(transientSettings);
  });

  test('should not update values when the /transient_settings payload has invalid sub-tabs for Container Engine preference page', async() => {
    let resp = await doRequest('/v1/transient_settings');
    const transientSettings = await resp.json();

    const requestedSettings = _.merge(
      {},
      transientSettings,
      { preferences: { navItem: { currentTabs: { 'Container Engine': 'behavior' } } } },
    );
    const resp2 = await doRequest('/v1/transient_settings', JSON.stringify(requestedSettings), 'PUT');

    expect(resp2.ok).toBeFalsy();
    expect(resp2.status).toEqual(400);

    // Now verify that the specified values did not get updated.
    resp = await doRequest('/v1/transient_settings');
    const refreshedSettings = await resp.json();

    expect(refreshedSettings).toEqual(transientSettings);
  });

  test('should not update values when the /transient_settings payload contains sub-tabs for a page not supporting sub-tabs: WSL / Virtual Machine', async() => {
    let resp = await doRequest('/v1/transient_settings');
    const transientSettings = await resp.json();

    const requestedSettings = _.merge(
      {},
      transientSettings,
      { preferences: { navItem: { currentTabs: { [process.platform === 'win32' ? 'WSL' : 'Virtual Machine']: 'behavior' } } } },
    );
    const resp2 = await doRequest('/v1/transient_settings', JSON.stringify(requestedSettings), 'PUT');

    expect(resp2.ok).toBeFalsy();
    expect(resp2.status).toEqual(400);

    // Now verify that the specified values did not get updated.
    resp = await doRequest('/v1/transient_settings');
    const refreshedSettings = await resp.json();

    expect(refreshedSettings).toEqual(transientSettings);
  });

  test('should not update values when the /transient_settings payload contains sub-tabs for a page not supporting sub-tabs: Kubernetes', async() => {
    let resp = await doRequest('/v1/transient_settings');
    const transientSettings = await resp.json();

    const requestedSettings = _.merge(
      {},
      transientSettings,
      { preferences: { navItem: { currentTabs: { Kubernetes: 'behavior' } } } },
    );
    const resp2 = await doRequest('/v1/transient_settings', JSON.stringify(requestedSettings), 'PUT');

    expect(resp2.ok).toBeFalsy();
    expect(resp2.status).toEqual(400);

    // Now verify that the specified values did not get updated.
    resp = await doRequest('/v1/transient_settings');
    const refreshedSettings = await resp.json();

    expect(refreshedSettings).toEqual(transientSettings);
  });

  test('should reject invalid JSON, transient settings request', async() => {
    const resp = await doRequest('/v1/transient_settings', '{"missing": "close-brace"', 'PUT');

    expect(resp.ok).toBeFalsy();
    expect(resp.status).toEqual(400);
    const body = resp.body.read().toString();

    expect(body).toContain('error processing JSON request block');
  });

  test('should reject empty payload, transient settings request', async() => {
    const resp = await doRequest('/v1/transient_settings', '', 'PUT');

    expect(resp.ok).toBeFalsy();
    expect(resp.status).toEqual(400);
    const body = resp.body.read().toString();

    expect(body).toContain('no settings specified in the request');
  });

  test.describe('v0 API', () => {
    const endpoints = {
      GET:  ['diagnostic_categories', 'diagnostic_checks', 'diagnostic_ids', 'settings', 'transient_settings'],
      PUT:  ['factory_reset', 'propose_settings', 'settings', 'shutdown', 'transient_settings'],
      POST: ['diagnostic_checks'],
    };

    test('should no longer work', async() => {
      for (const method in endpoints) {
        for (const endpoint of endpoints[method as 'GET'|'PUT']) {
          const resp = await doRequest(`/v0/${ endpoint }`, '', method);

          expect({
            ok:     resp.ok,
            status: resp.status,
            body:   resp.body.read().toString(),
          }).toEqual({
            ok:     false,
            status: 400,
            body:   `Invalid version "/v0" for endpoint "${ method } /v0/${ endpoint }" - use "/v1/${ endpoint }"`,
          });
        }
      }
    });
  });

  test.describe('rdctl', () => {
    test.describe('config-file and parameters', () => {
      test.describe("when the config-file doesn't exist", () => {
        let parameters: string[];
        const configFilePath = path.join(paths.appHome, 'rd-engine.json');
        const backupPath = path.join(paths.appHome, 'rd-engine.json.bak');

        test.beforeAll(async() => {
          const dataRaw = await fs.promises.readFile(configFilePath, 'utf-8');

          serverState = JSON.parse(dataRaw);
          parameters = [`--password=${ serverState.password }`,
            `--port=${ serverState.port }`,
            `--user=${ serverState.user }`,
          ];
          await expect(fs.promises.rename(configFilePath, backupPath)).resolves.toBeUndefined();
        });
        test.afterAll(async() => {
          await expect(fs.promises.rename(backupPath, configFilePath)).resolves.toBeUndefined();
        });

        test('it complains with no parameters,', async() => {
          const { stdout, stderr, error } = await rdctl(['list-settings']);

          expect({
            stdout, stderr, error,
          }).toEqual({
            error:  expect.any(Error),
            stderr: expect.stringContaining(`Error: failed to get connection info: open ${ configFilePath }: ${ ENOENTMessage }`),
            stdout: '',
          });
          expect(stderr).not.toContain('Usage:');
        });

        test('it works with all parameters,', async() => {
          const { stdout, stderr, error } = await rdctl(parameters.concat(['list-settings']));

          expect({
            stdout, stderr, error,
          }).toEqual({
            error:  undefined,
            stderr: '',
            stdout: expect.stringContaining('"kubernetes":'),
          });
          verifySettingsKeys(JSON.parse(stdout));
        });
        test("it complains when some parameters aren't specified", async() => {
          for (let idx = 0; idx < parameters.length; idx += 1) {
            const partialParameters = parameters.slice(0, idx).concat(parameters.slice(idx + 1));
            const { stdout, stderr, error } = await rdctl(partialParameters.concat(['list-settings']));

            expect({
              stdout, stderr, error,
            }).toEqual({
              error:  expect.any(Error),
              stderr: expect.stringContaining(`Error: failed to get connection info: open ${ configFilePath }: ${ ENOENTMessage }`),
              stdout: '',
            });
            expect(stderr).not.toContain('Usage:');
          }
        });
        test.describe('when a nonexistent config file is specified', () => {
          test('it fails even when all parameters are specified', async() => {
            const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rd-fake-docker'));

            try {
              const configFile = path.join(tmpDir, 'config.json');
              // Do not actually create configFile
              const { stdout, stderr, error } = await rdctl(parameters.concat(['list-settings', '--config-path', configFile]));

              expect({
                stdout, stderr, error,
              }).toEqual({
                error:  expect.any(Error),
                stderr: expect.stringContaining(`Error: failed to get connection info: open ${ configFile }: ${ ENOENTMessage }`),
                stdout: '',
              });
              expect(stderr).not.toContain('Usage:');
            } finally {
              await fs.promises.rm(tmpDir, { recursive: true });
            }
          });
        });
      });
    });
    test('should show settings and nil-update settings', async() => {
      const { stdout, stderr, error } = await rdctl(['list-settings']);

      expect({
        stdout, stderr, error,
      }).toEqual({
        error:  undefined,
        stderr: '',
        stdout: expect.stringContaining('"kubernetes":'),
      });
      const settings = JSON.parse(stdout);

      verifySettingsKeys(settings);

      const args = ['set',
        '--container-engine', settings.containerEngine.name,
        `--kubernetes-enabled=${ !!settings.kubernetes.enabled }`,
        '--kubernetes-version', settings.kubernetes.version];
      const result = await rdctl(args);

      expect(result).toMatchObject({
        stderr: '',
        stdout: expect.stringContaining('Status: no changes necessary.'),
      });
    });

    test.describe('set', () => {
      const unsupportedPrefsByPlatform: {[x in NodeJS.Platform] ?: [string, any][]} = {
        win32: [
          ['application.admin-access', true],
          ['application.path-management-strategy', 'rcfiles'],
          ['experimental.virtual-machine.mount.9p.cache-mode', CacheMode.MMAP],
          ['experimental.virtual-machine.mount.9p.msize-in-kib', 128],
          ['experimental.virtual-machine.mount.9p.protocol-version', ProtocolVersion.NINEP2000_L],
          ['experimental.virtual-machine.mount.9p.security-model', SecurityModel.NONE],
          ['virtual-machine.memory-in-gb', 10],
          ['virtual-machine.mount.type', MountType.NINEP],
          ['virtual-machine.number-cpus', 10],
          ['virtual-machine.type', VMType.VZ],
          ['virtual-machine.use-rosetta', true],
        ],
        darwin: [
          ['kubernetes.ingress.localhost-only', true],
        ],
        linux: [
          ['experimental.virtual-machine.proxy.enabled', true],
          ['virtual-machine.type', VMType.VZ],
          ['virtual-machine.use-rosetta', true],
        ],
      };
      const unsupportedOptions = unsupportedPrefsByPlatform[os.platform()] ?? [];
      const commonOptions = [
        'container-engine.name',
        'container-engine.allowed-images.enabled',
        'kubernetes.version',
        'kubernetes.port',
        'kubernetes.options.traefik',
        'port-forwarding.include-kubernetes-services',
      ];

      test('complains when no args are given', async() => {
        const { stdout, stderr, error } = await rdctl(['set']);

        expect({
          stdout, stderr, error,
        }).toEqual({
          error:  expect.any(Error),
          stderr: expect.stringContaining('Error: set command: no settings to change were given'),
          stdout: '',
        });
        expect(stderr).toContain('Usage:');
        const options = stderr.split(/\n/)
          .filter(line => /^\s+--/.test(line))
          .map(line => (/\s+--([-.\w]+)\s/.exec(line) || [])[1])
          .filter(line => line);

        // This part is a bit subtle
        // Require that the received options contain at least all the common options
        expect(options).toEqual(expect.arrayContaining(commonOptions));
        // We can't use `not.toEqual.arrayContaining` for the unsupported options because if the received
        // list contains some but not all of the unsupported options the not-test will still succeed
        for (const option of unsupportedOptions) {
          expect(options).not.toContain(option[0]);
        }
      });

      test('complains when option value missing', async() => {
        const { stdout, stderr, error } = await rdctl(['set', '--container-engine']);

        expect({
          stdout, stderr, error,
        }).toEqual({
          error:  expect.any(Error),
          stderr: expect.stringContaining('Error: flag needs an argument: --container-engine'),
          stdout: '',
        });
        expect(stderr).toContain('Usage:');
      });

      test('complains when non-boolean option value specified', async() => {
        const { stdout, stderr, error } = await rdctl(['set', '--kubernetes-enabled=gorb']);

        expect({
          stdout, stderr, error,
        }).toEqual({
          error:  expect.any(Error),
          stderr: expect.stringContaining('Error: invalid argument "gorb" for "--kubernetes-enabled" flag: strconv.ParseBool: parsing "gorb": invalid syntax'),
          stdout: '',
        });
        expect(stderr).toContain('Usage:');
      });

      test('complains when invalid engine specified', async() => {
        const myEngine = 'giblets';
        const { stdout, stderr, error } = await rdctl(['set', `--container-engine=${ myEngine }`]);

        expect({
          stdout, stderr, error,
        }).toEqual({
          error:  expect.any(Error),
          stderr: expect.stringContaining(`Error: invalid value for option --container-engine: "${ myEngine }"; must be 'containerd', 'docker', or 'moby'`),
          stdout: '',
        });
        expect(stderr).not.toContain('Error: errors in attempt to update settings:');
        expect(stderr).not.toContain('Usage:');
      });

      test('complains when server rejects a proposed version', async() => {
        const { stdout, stderr, error } = await rdctl(['set', '--kubernetes-version=karl']);

        expect({
          stdout, stderr, error,
        }).toEqual({
          error:  expect.any(Error),
          stderr: expect.stringMatching(/Error: errors in attempt to update settings:\s+Kubernetes version "karl" not found./),
          stdout: '',
        });
        expect(stderr).not.toContain('Usage:');
      });

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
            addPathManagementStrategy(oldSettings, body);
            break;
          case 'linux':
            addPathManagementStrategy(oldSettings, body);
            break;
          case 'win32':
            body.kubernetes.WSLIntegrations ??= {};
            body.kubernetes.WSLIntegrations.bosco = true;
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
          const navPage = new NavPage(page);

          await navPage.progressBecomesReady();
        });
      });

      test('complains about options not intended for current platform', async() => {
        // playwright doesn't support test.each
        // See https://github.com/microsoft/playwright/issues/7036 for the discussion

        for (const [option, newValue] of unsupportedOptions) {
          await expect(rdctl(['set', `--${ option }=${ newValue }`])).resolves
            .toMatchObject({ stderr: expect.stringContaining(`Error: option --${ option } is not available on`) });
        }
      });
    });

    test.describe('all server commands', () => {
      test.describe('complains about unrecognized/extra arguments', () => {
        const badArgs = ['string', 'brucebean'];

        for (const cmd of ['set', 'list-settings', 'shutdown']) {
          const args = [cmd, ...badArgs];

          test(args.join(' '), async() => {
            const { stdout, stderr, error } = await rdctl(args);

            expect({
              stdout, stderr, error,
            }).toEqual({
              error:  expect.any(Error),
              stderr: expect.stringContaining(`Error: unknown command "string" for "rdctl ${ cmd }"`),
              stdout: '',
            });
            expect(stderr).toContain('Usage:');
          });
        }
      });

      test.describe('complains when unrecognized options are given', () => {
        for (const cmd of ['set', 'list-settings', 'shutdown']) {
          const args = [cmd, '--Awop-bop-a-loo-mop', 'zips', '--alop-bom-bom=cows'];

          test(args.join(' '), async() => {
            const { stdout, stderr, error } = await rdctl(args);

            expect({
              stdout, stderr, error,
            }).toEqual({
              error:  expect.any(Error),
              stderr: expect.stringContaining(`Error: unknown flag: ${ args[1] }`),
              stdout: '',
            });
            expect(stderr).toContain('Usage:');
          });
        }
      });
    });

    test.describe('api', () => {
      test.describe('all subcommands', () => {
        test('complains when no args are given', async() => {
          const { stdout, stderr, error } = await rdctl(['api']);

          expect({
            stdout, stderr, error,
          }).toEqual({
            error:  expect.any(Error),
            stderr: expect.stringContaining('Error: api command: no endpoint specified'),
            stdout: '',
          });
          expect(stderr).toContain('Usage:');
        });

        test('empty string endpoint should give an error message', async() => {
          const { stdout, stderr, error } = await rdctl(['api', '']);

          expect({
            stdout, stderr, error,
          }).toEqual({
            error:  expect.any(Error),
            stderr: expect.stringContaining('Error: api command: no endpoint specified'),
            stdout: '',
          });
          expect(stderr).toContain('Usage:');
        });

        test('complains when more than one endpoint is given', async() => {
          const endpoints = ['settings', '/v1/settings'];
          const { stdout, stderr, error } = await rdctl(['api', ...endpoints]);

          expect({
            stdout, stderr, error,
          }).toEqual({
            error:  expect.any(Error),
            stderr: expect.stringContaining(`Error: api command: too many endpoints specified ([${ endpoints.join(' ') }]); exactly one must be specified`),
            stdout: '',
          });
          expect(stderr).toContain('Usage:');
        });
      });

      test.describe('settings', () => {
        test.describe('options:', () => {
          test.describe('GET', () => {
            for (const endpoint of ['settings', '/v1/settings']) {
              for (const methodSpecs of [[], ['-X', 'GET'], ['--method', 'GET']]) {
                const args = ['api', endpoint, ...methodSpecs];

                test(args.join(' '), async() => {
                  const { stdout, stderr, error } = await rdctl(args);

                  expect({
                    stdout, stderr, error,
                  }).toEqual({
                    error:  undefined,
                    stderr: '',
                    stdout: expect.stringMatching(/{.+}/s),
                  });
                  verifySettingsKeys(JSON.parse(stdout));
                });
              }
            }
          });

          test.describe('PUT', () => {
            test.describe('from stdin', () => {
              const settingsFile = path.join(paths.config, 'settings.json');

              for (const endpoint of ['settings', '/v1/settings']) {
                for (const methodSpec of ['-X', '--method']) {
                  for (const inputSpec of [['--input', '-'], ['--input=-']]) {
                    const args = ['api', endpoint, methodSpec, 'PUT', ...inputSpec];

                    test(args.join(' '), async() => {
                      const { stdout, stderr, error } = await rdctlWithStdin(settingsFile, args);

                      expect({
                        stdout, stderr, error,
                      }).toEqual({
                        error:  undefined,
                        stderr: '',
                        stdout: expect.not.stringContaining('apply'),
                      });
                    });
                  }
                }
              }
            });
            test.describe('--input', () => {
              const settingsFile = path.join(paths.config, 'settings.json');

              for (const endpoint of ['settings', '/v1/settings']) {
                for (const methodSpecs of [['-X', 'PUT'], ['--method', 'PUT'], []]) {
                  for (const inputSource of [['--input', settingsFile], [`--input=${ settingsFile }`]]) {
                    const args = ['api', endpoint, ...methodSpecs, ...inputSource];

                    test(args.join(' '), async() => {
                      const { stdout, stderr, error } = await rdctl(args);

                      expect({
                        stdout, stderr, error,
                      }).toEqual({
                        error:  undefined,
                        stderr: '',
                        stdout: expect.stringContaining('no changes necessary'),
                      });
                    });
                  }
                }
              }
            });

            test('should complain about a "--input-" flag', async() => {
              const { stdout, stderr, error } = await rdctl(['api', '/settings', '-X', 'PUT', '--input-']);

              expect({
                stdout, stderr, error,
              }).toEqual({
                error:  expect.any(Error),
                stderr: expect.stringContaining('Error: unknown flag: --input-'),
                stdout: '',
              });
              expect(stderr).toContain('Usage:');
            });

            test.describe('from body', () => {
              const settingsFile = path.join(paths.config, 'settings.json');

              for (const endpoint of ['settings', '/v1/settings']) {
                for (const methodSpecs of [[], ['-X', 'PUT'], ['--method', 'PUT']]) {
                  for (const inputOption of ['--body', '-b']) {
                    const args = ['api', endpoint, ...methodSpecs, inputOption];

                    test(args.join(' '), async() => {
                      const settingsBody = await fs.promises.readFile(settingsFile, { encoding: 'utf-8' });
                      const { stdout, stderr, error } = await rdctl(args.concat(settingsBody));

                      expect({
                        stdout, stderr, error,
                      }).toEqual({
                        error:  undefined,
                        stderr: '',
                        stdout: expect.stringContaining('no changes necessary'),
                      });
                    });
                  }
                }
              }
            });

            test.describe('complains when body and input are both specified', () => {
              for (const bodyOption of ['--body', '-b']) {
                const args = ['api', 'settings', bodyOption, '{ "doctor": { "wu" : "tang" }}', '--input', 'mabels.farm'];

                test(args.join(' '), async() => {
                  const { stdout, stderr, error } = await rdctl(args);

                  expect({
                    stdout, stderr, error,
                  }).toEqual({
                    error:  expect.any(Error),
                    stderr: expect.stringContaining('Error: api command: --body and --input options cannot both be specified'),
                    stdout: '',
                  });
                  expect(stderr).toContain('Usage:');
                });
              }
            });

            test('complains when no body is provided', async() => {
              const { stdout, stderr, error } = await rdctl(['api', 'settings', '-X', 'PUT']);

              expect({
                stdout, stderr, error,
              }).toEqual({
                error:  expect.any(Error),
                stderr: expect.stringContaining('no settings specified in the request'),
                stdout: expect.stringMatching(/{.*}/s),
              });
              expect(JSON.parse(stdout)).toEqual({ message: '400 Bad Request' } );
              expect(stderr).not.toContain('Usage:');
            });

            test('invalid setting is specified', async() => {
              const newSettings = { version: CURRENT_SETTINGS_VERSION, containerEngine: { name: 'beefalo' } };
              const { stdout, stderr, error } = await rdctl(['api', 'settings', '-b', JSON.stringify(newSettings)]);

              expect({
                stdout, stderr, error,
              }).toEqual({
                error:  expect.any(Error),
                stderr: expect.stringMatching(/errors in attempt to update settings:\s+Invalid value for "containerEngine.name": <"beefalo">; must be one of \["containerd","moby","docker"\]/),
                stdout: expect.stringMatching(/{.*}/s),
              });
              expect(stderr).not.toContain('Usage:');
              expect(JSON.parse(stdout)).toEqual({ message: '400 Bad Request' } );
            });
          });
        });
      });

      test('complains on invalid endpoint', async() => {
        const endpoint = '/v99/no/such/endpoint';
        const { stdout, stderr, error } = await rdctl(['api', endpoint]);

        expect({
          stdout, stderr, error,
        }).toEqual({
          error:  expect.any(Error),
          stderr: expect.stringContaining(`Unknown command: GET ${ endpoint }`),
          stdout: expect.stringMatching(/{.*}/s),
        });
        expect(JSON.parse(stdout)).toEqual({ message: '404 Not Found' });
        expect(stderr).not.toContain('Usage:');
      });

      test('complains on invalid unversioned endpoint', async() => {
        const endpoint = '/v1/shazbat';
        const { stdout, stderr, error } = await rdctl(['api', endpoint]);

        expect({
          stdout, stderr, error,
        }).toEqual({
          error:  expect.any(Error),
          stderr: expect.stringContaining(`Unknown command: GET ${ endpoint }`),
          stdout: expect.stringMatching(/{".+?":".+"}/),
        });
        expect(JSON.parse(stdout)).toEqual({ message: '404 Not Found' });
        expect(stderr).not.toContain('Usage:');
      });

      test.describe('getting endpoints', () => {
        async function getEndpoints() {
          const apiSpecPath = path.join(import.meta.dirname, '../pkg/rancher-desktop/assets/specs/command-api.yaml');
          const apiSpec = await fs.promises.readFile(apiSpecPath, 'utf-8');
          const specPaths = yaml.parse(apiSpec).paths;

          return Object.entries<Record<string, unknown>>(specPaths)
            .flatMap(([path, data]) => Object.keys(data).map(method => [path, method]))
            .sort();
        }

        test('no paths should return all supported endpoints', async() => {
          const { stdout, stderr } = await rdctl(['api', '/']);
          const endpoints = (await getEndpoints())
            .map(([path, method]) => `${ method.toUpperCase() } ${ path }`);

          expect(stderr).toEqual('');
          expect(JSON.parse(stdout).sort()).toEqual(endpoints.sort());
        });

        test('version-only path for v0 should return only itself', async() => {
          const { stdout, stderr } = await rdctl(['api', '/v0']);

          expect(stderr).toEqual('');
          expect(JSON.parse(stdout)).toEqual([
            'GET /v0',
          ]);
        });

        test('version-only path for v1 should return all endpoints in that version only', async() => {
          const { stdout, stderr } = await rdctl(['api', '/v1']);
          const endpoints = (await getEndpoints())
            .filter(([path]) => path.startsWith('/v1'))
            .map(([path, method]) => `${ method.toUpperCase() } ${ path }`);

          expect(stderr).toEqual('');
          expect(JSON.parse(stdout).sort()).toEqual(endpoints.sort());
        });
        test('/v2 should fail', async() => {
          const { stdout, stderr } = await rdctl(['api', '/v2']);

          expect({ stdout: JSON.parse(stdout), stderr: stderr.trim() }).toMatchObject({ stdout: { message: '404 Not Found' }, stderr: 'Unknown command: GET /v2' });
        });
      });

      test.describe('diagnostics', () => {
        let categories: string[];

        test('categories', async() => {
          const { stdout, stderr } = await rdctl(['api', '/v1/diagnostic_categories']);

          expect(stderr).toEqual('');
          categories = JSON.parse(stdout);
          expect(categories).toEqual(expect.arrayContaining(['Networking']));
        });
        test.skip('it finds the IDs for Utilities', async() => {
          const { stdout, stderr } = await rdctl(['api', '/v1/diagnostic_ids?category=Utilities']);

          expect(stderr).toEqual('');
          expect(JSON.parse(stdout)).toEqual(expect.arrayContaining(['RD_BIN_IN_BASH_PATH', 'RD_BIN_SYMLINKS']));
        });
        test('it finds the IDs for Networking', async() => {
          const { stdout, stderr } = await rdctl(['api', '/v1/diagnostic_ids?category=Networking']);

          expect(stderr).toEqual('');
          expect(JSON.parse(stdout)).toEqual(expect.arrayContaining(['CONNECTED_TO_INTERNET']));
        });
        test('it 404s for a nonexistent category', async() => {
          const { stdout, stderr } = await rdctl(['api', '/v1/diagnostic_ids?category=cecinestpasuncategory']);

          expect({ stdout: JSON.parse(stdout), stderr: stderr.trim() }).toMatchObject({ stdout: { message: '404 Not Found' }, stderr: 'No diagnostic checks found in category cecinestpasuncategory' });
        });
        test('it finds a diagnostic check', async() => {
          const { stdout, stderr } = await rdctl(['api', '/v1/diagnostic_checks?category=Networking&id=CONNECTED_TO_INTERNET']);

          expect(stderr).toEqual('');
          expect(JSON.parse(stdout)).toMatchObject({
            checks: [{
              id:          'CONNECTED_TO_INTERNET',
              description: 'The application cannot reach the general internet for updated kubernetes versions and other components, but can still operate.',
              mute:        false,
            }],
          });
        });
        test('it finds all diagnostic checks', async() => {
          const { stdout, stderr } = await rdctl(['api', '/v1/diagnostic_checks']);

          expect(stderr).toEqual('');
          expect(JSON.parse(stdout)).toMatchObject({
            checks: expect.arrayContaining([
              {
                category:    'Networking',
                id:          'CONNECTED_TO_INTERNET',
                description: 'The application cannot reach the general internet for updated kubernetes versions and other components, but can still operate.',
                mute:        false,
                fixes:       [],
                passed:      expect.any(Boolean),
              },
            ]),
          });
        });
        test.skip('it finds all diagnostic checks for a category', async() => {
          const { stdout, stderr } = await rdctl(['api', '/v1/diagnostic_checks?category=Utilities']);

          expect(stderr).toEqual('');
          expect(JSON.parse(stdout)).toEqual({
            checks: [
              {
                category:    'Utilities',
                id:          'RD_BIN_IN_BASH_PATH',
                description: 'The ~/.rd/bin directory has not been added to the PATH, so command-line utilities are not configured in your bash shell.',
                mute:        false,
                fixes:       [
                  { description: 'You have selected manual PATH configuration. You can let Rancher Desktop automatically configure it.' },
                ],
              },
              {
                category:    'Utilities',
                id:          'RD_BIN_SYMLINKS',
                description: 'Are the files under ~/.docker/cli-plugins symlinks to ~/.rd/bin?',
                mute:        false,
                fixes:       [
                  { description: 'Replace existing files in ~/.rd/bin with symlinks to the application\'s internal utility directory.' },
                ],
              },
            ],
          });
        });
        test('it finds a diagnostic check by checkID', async() => {
          const { stdout, stderr } = await rdctl(['api', '/v1/diagnostic_checks?id=CONNECTED_TO_INTERNET']);

          expect(stderr).toEqual('');
          expect(JSON.parse(stdout)).toMatchObject({
            checks: [
              {
                category:    'Networking',
                id:          'CONNECTED_TO_INTERNET',
                description: 'The application cannot reach the general internet for updated kubernetes versions and other components, but can still operate.',
                mute:        false,
              },
            ],
          });
        });
        test('it returns an empty array for a nonexistent category', async() => {
          const { stdout, stderr } = await rdctl(['api', '/v1/diagnostic_checks?category=not*a*category']);

          expect({ stdout: JSON.parse(stdout), stderr } ).toMatchObject({ stdout: { checks: [] }, stderr: '' });
        });
        test('it returns an empty array for a nonexistent category with a valid ID', async() => {
          const { stdout, stderr } = await rdctl(['api', '/v1/diagnostic_checks?category=not*a*category&id=CONNECTED_TO_INTERNET']);

          expect({ stdout: JSON.parse(stdout), stderr } ).toMatchObject({ stdout: { checks: [] }, stderr: '' });
        });
        test('it returns an empty array for a nonexistent checkID with a valid category', async() => {
          const { stdout, stderr } = await rdctl(['api', '/v1/diagnostic_checks?category=Utilities&id=CONNECTED_TO_INTERNET']);

          expect({ stdout: JSON.parse(stdout), stderr } ).toMatchObject({ stdout: { checks: [] }, stderr: '' });
        });
        test('it returns an empty array for a nonexistent checkID when no category is specified', async() => {
          const { stdout, stderr } = await rdctl(['api', '/v1/diagnostic_checks?&id=blip']);

          expect({ stdout: JSON.parse(stdout), stderr } ).toMatchObject({ stdout: { checks: [] }, stderr: '' });
        });
      });

      test.describe('other endpoints', () => {
        test('it can find the about text', async() => {
          const { stdout, stderr } = await rdctl(['api', '/v1/about']);

          expect(stderr).toEqual('');
          expect(stdout).toMatch(/\w+/);
        });
      });
    });

    test.describe('shell', () => {
      test('can run echo', async() => {
        const { stdout, stderr, error } = await rdctl(['shell', 'echo', 'abc', 'def']);

        expect({
          stdout, stderr, error,
        }).toEqual({
          error:  undefined,
          stderr: '',
          stdout: expect.stringContaining('abc def'),
        });
      });
      test('can run a command with a dash-option', async() => {
        const { stdout, stderr, error } = await rdctl(['shell', 'uname', '-a']);

        expect({
          stdout, stderr, error,
        }).toEqual({
          error:  undefined,
          stderr: '',
          stdout: expect.stringMatching(/\S/),
        });
      });
      test('can run a shell', async() => {
        const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rdctl-shell-input'));
        const inputPath = path.join(tmpDir, 'echo.txt');

        try {
          await fs.promises.writeFile(inputPath, 'echo orate linds chump\n');
          const { stdout, stderr, error } = await rdctlWithStdin(inputPath, ['shell']);

          expect({
            stdout, stderr, error,
          }).toEqual({
            error:  undefined,
            stderr: '',
            stdout: expect.stringContaining('orate linds chump'),
          });
        } finally {
          await fs.promises.rm(tmpDir, { recursive: true, force: true });
        }
      });
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
