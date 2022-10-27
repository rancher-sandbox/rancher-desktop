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
import fetch, { RequestInit } from 'node-fetch';
import { BrowserContext, ElectronApplication, Page, _electron } from 'playwright';

import { NavPage } from './pages/nav-page';
import {
  createDefaultSettings, kubectl, packageLogs, reportAsset, tool,
} from './utils/TestUtils';

import { ContainerEngine, Settings } from '@/config/settings';
import { ServerState } from '@/main/commandServer/httpCommandServer';
import { spawnFile } from '@/utils/childProcess';
import paths from '@/utils/paths';
import { RecursivePartial } from '@/utils/typeUtils';

test.describe('Command server', () => {
  let electronApp: ElectronApplication;
  let context: BrowserContext;
  let serverState: ServerState;
  let page: Page;
  const ENOENTMessage = os.platform() === 'win32' ? 'The system cannot find the file specified' : 'no such file or directory';
  const appPath = path.join(__dirname, '../');

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
    expect(new Set(['version', 'containerEngine', 'kubernetes', 'portForwarding', 'images', 'telemetry',
      'updater', 'debug', 'pathManagementStrategy', 'diagnostics']))
      .toEqual(new Set(Object.keys(settings)));
  }

  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async() => {
    createDefaultSettings();
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

  test.afterAll(async() => {
    await context.tracing.stop({ path: reportAsset(__filename) });
    await packageLogs(__filename);
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
    expect(serverState).toEqual(expect.objectContaining({
      user:     expect.any(String),
      password: expect.any(String),
      port:     expect.any(Number),
      pid:      expect.any(Number),
    }));
  });

  test('should require authentication, settings request', async() => {
    const url = `http://127.0.0.1:${ serverState.port }/v0/settings`;
    const resp = await fetch(url);

    expect(resp).toEqual(expect.objectContaining({
      ok:     false,
      status: 401,
    }));
  });

  test('should emit CORS headers, settings request', async() => {
    const resp = await doRequest('/v0/settings', '', 'OPTIONS');

    expect({
      ...resp,
      ok:      !!resp.ok,
      headers: Object.fromEntries(resp.headers.entries()),
    }).toEqual(expect.objectContaining({
      ok:      true,
      headers: expect.objectContaining({
        'access-control-allow-headers': 'Authorization',
        'access-control-allow-methods': 'GET, PUT',
        'access-control-allow-origin':  '*',
      }),
    }));
  });

  test('should be able to get settings', async() => {
    const resp = await doRequest('/v0/settings');

    expect({
      ...resp,
      ok:      !!resp.ok,
      headers: Object.fromEntries(resp.headers.entries()),
    }).toEqual(expect.objectContaining({
      ok:      true,
      headers: expect.objectContaining({
        'access-control-allow-headers': 'Authorization',
        'access-control-allow-methods': 'GET, PUT',
        'access-control-allow-origin':  '*',
      }),
    }));
    expect(await resp.json()).toHaveProperty('kubernetes');
  });

  test('setting existing settings should be a no-op', async() => {
    let resp = await doRequest('/v0/settings');
    const rawSettings = resp.body.read().toString();

    resp = await doRequest('/v0/settings', rawSettings, 'PUT');
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
    let resp = await doRequest('/v0/settings');
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
        },
    });
    const resp2 = await doRequest('/v0/settings', JSON.stringify(requestedSettings), 'PUT');

    expect(resp2.ok).toBeFalsy();
    expect(resp2.status).toEqual(400);

    // Now verify that the specified values did not get updated.
    resp = await doRequest('/v0/settings');
    const refreshedSettings = await resp.json();

    expect(refreshedSettings).toEqual(settings);
  });

  test('should return multiple error messages, settings request', async() => {
    const newSettings: Record<string, any> = {
      kubernetes:     {
        WSLIntegrations: "ceci n'est pas un objet",
        stoinks:         'yikes!', // should be ignored
        memoryInGB:      'carl',
        containerEngine: { status: 'should be a scalar' },
      },
      portForwarding: 'bob',
      telemetry:      { oops: 15 },
    };
    const resp2 = await doRequest('/v0/settings', JSON.stringify(newSettings), 'PUT');

    expect(resp2.ok).toBeFalsy();
    expect(resp2.status).toEqual(400);
    const body = resp2.body.read().toString();
    const expectedWSL = {
      win32:  "Proposed field kubernetes.WSLIntegrations should be an object, got <ceci n'est pas un objet>.",
      lima:  "Changing field kubernetes.WSLIntegrations via the API isn't supported.",
    }[os.platform() === 'win32' ? 'win32' : 'lima'];
    const expectedMemory = {
      win32: "Changing field kubernetes.memoryInGB via the API isn't supported.",
      lima:  'Invalid value for kubernetes.memoryInGB: <"carl">',
    }[os.platform() === 'win32' ? 'win32' : 'lima'];
    const expectedLines = [
      expectedWSL,
      expectedMemory,
      `Invalid value for kubernetes.containerEngine: <{"status":"should be a scalar"}>; must be 'containerd', 'docker', or 'moby'`,
      'Setting portForwarding should wrap an inner object, but got <bob>.',
      'Invalid value for telemetry: <{"oops":15}>',
    ];

    expect(body.split(/\r?\n/g)).toEqual(expect.arrayContaining(expectedLines));
  });

  test('should reject invalid JSON, settings request', async() => {
    const resp = await doRequest('/v0/settings', '{"missing": "close-brace"', 'PUT');

    expect(resp.ok).toBeFalsy();
    expect(resp.status).toEqual(400);
    const body = resp.body.read().toString();

    expect(body).toContain('error processing JSON request block');
  });

  test('should reject empty payload, settings request', async() => {
    const resp = await doRequest('/v0/settings', '', 'PUT');

    expect(resp.ok).toBeFalsy();
    expect(resp.status).toEqual(400);
    const body = resp.body.read().toString();

    expect(body).toContain('no settings specified in the request');
  });

  test('version-only path of a non-existent version should 404', async() => {
    const resp = await doRequest('/v99bottlesofbeeronthewall');

    expect(resp.ok).toBeFalsy();
    expect(resp.status).toEqual(404);
    const body = resp.body.read().toString();

    expect(body).toContain('Unknown command: GET /v99bottlesofbeeronthewall');
  });

  test('should not restart on unrelated changes', async() => {
    let resp = await doRequest('/v0/settings');
    let telemetry = false;

    expect(resp.ok).toBeTruthy();
    telemetry = (await resp.json() as Settings).telemetry;
    resp = await doRequest('/v0/settings', JSON.stringify({ telemetry: !telemetry }), 'PUT');
    expect(resp.ok).toBeTruthy();
    await expect(resp.text()).resolves.toContain('no restart required');
  });

  test('should require authentication, transient settings request', async() => {
    const url = `http://127.0.0.1:${ serverState.port }/v0/transient_settings`;
    const resp = await fetch(url);

    expect(resp).toEqual(expect.objectContaining({
      ok:     false,
      status: 401,
    }));
  });

  test('should emit CORS headers, transient settings request', async() => {
    const resp = await doRequest('/v0/transient_settings', '', 'OPTIONS');

    expect({
      ...resp,
      ok:      !!resp.ok,
      headers: Object.fromEntries(resp.headers.entries()),
    }).toEqual(expect.objectContaining({
      ok:      true,
      headers: expect.objectContaining({
        'access-control-allow-headers': 'Authorization',
        'access-control-allow-methods': 'GET, PUT',
        'access-control-allow-origin':  '*',
      }),
    }));
  });

  test('should be able to get transient settings', async() => {
    const resp = await doRequest('/v0/transient_settings');

    expect({
      ...resp,
      ok:      !!resp.ok,
      headers: Object.fromEntries(resp.headers.entries()),
    }).toEqual(expect.objectContaining({
      ok:      true,
      headers: expect.objectContaining({
        'access-control-allow-headers': 'Authorization',
        'access-control-allow-methods': 'GET, PUT',
        'access-control-allow-origin':  '*',
      }),
    }));
    expect(await resp.json()).toHaveProperty('noModalDialogs');
  });

  test('setting existing transient settings should be a no-op', async() => {
    let resp = await doRequest('/v0/transient_settings');
    const rawSettings = resp.body.read().toString();

    resp = await doRequest('/v0/transient_settings', rawSettings, 'PUT');
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

  test('should not update values when the /transient_settings currentNavItem payload is invalid', async() => {
    let resp = await doRequest('/v0/transient_settings');
    const transientSettings = await resp.json();

    const requestedSettings = _.merge({}, transientSettings, { preferences: { currentNavItem: { name: 'foo', bar: 'bar' } } });
    const resp2 = await doRequest('/v0/transient_settings', JSON.stringify(requestedSettings), 'PUT');

    expect(resp2.ok).toBeFalsy();
    expect(resp2.status).toEqual(400);

    // Now verify that the specified values did not get updated.
    resp = await doRequest('/v0/transient_settings');
    const refreshedSettings = await resp.json();

    expect(refreshedSettings).toEqual(transientSettings);
  });

  test('should not update values when the /transient_settings payload has invalid currentNavItem name', async() => {
    let resp = await doRequest('/v0/transient_settings');
    const transientSettings = await resp.json();

    const requestedSettings = _.merge({}, transientSettings, { preferences: { currentNavItem: { name: 'foo' } } });
    const resp2 = await doRequest('/v0/transient_settings', JSON.stringify(requestedSettings), 'PUT');

    expect(resp2.ok).toBeFalsy();
    expect(resp2.status).toEqual(400);

    // Now verify that the specified values did not get updated.
    resp = await doRequest('/v0/transient_settings');
    const refreshedSettings = await resp.json();

    expect(refreshedSettings).toEqual(transientSettings);
  });

  test('should not update values when the /transient_settings payload has invalid currentNavItem tab', async() => {
    let resp = await doRequest('/v0/transient_settings');
    const transientSettings = await resp.json();

    const requestedSettings = _.merge({}, transientSettings, { preferences: { currentNavItem: { name: 'Application', tab: 'bar' } } });
    const resp2 = await doRequest('/v0/transient_settings', JSON.stringify(requestedSettings), 'PUT');

    expect(resp2.ok).toBeFalsy();
    expect(resp2.status).toEqual(400);

    // Now verify that the specified values did not get updated.
    resp = await doRequest('/v0/transient_settings');
    const refreshedSettings = await resp.json();

    expect(refreshedSettings).toEqual(transientSettings);
  });

  test('should not update values when the /transient_settings payload contains sub-tabs for a page not supporting sub-tabs: WSL / Virtual Machine', async() => {
    let resp = await doRequest('/v0/transient_settings');
    const transientSettings = await resp.json();

    const requestedSettings = _.merge({}, transientSettings, { preferences: { currentNavItem: { name: process.platform === 'win32' ? 'WSL' : 'Virtual Machine', tab: 'behavior' } } });
    const resp2 = await doRequest('/v0/transient_settings', JSON.stringify(requestedSettings), 'PUT');

    expect(resp2.ok).toBeFalsy();
    expect(resp2.status).toEqual(400);

    // Now verify that the specified values did not get updated.
    resp = await doRequest('/v0/transient_settings');
    const refreshedSettings = await resp.json();

    expect(refreshedSettings).toEqual(transientSettings);
  });

  test('should not update values when the /transient_settings payload contains sub-tabs for a page not supporting sub-tabs: Container Engine', async() => {
    let resp = await doRequest('/v0/transient_settings');
    const transientSettings = await resp.json();

    const requestedSettings = _.merge({}, transientSettings, { preferences: { currentNavItem: { name: 'Container Engine', tab: 'environment' } } });
    const resp2 = await doRequest('/v0/transient_settings', JSON.stringify(requestedSettings), 'PUT');

    expect(resp2.ok).toBeFalsy();
    expect(resp2.status).toEqual(400);

    // Now verify that the specified values did not get updated.
    resp = await doRequest('/v0/transient_settings');
    const refreshedSettings = await resp.json();

    expect(refreshedSettings).toEqual(transientSettings);
  });

  test('should not update values when the /transient_settings payload contains sub-tabs for a page not supporting sub-tabs: Kubernetes', async() => {
    let resp = await doRequest('/v0/transient_settings');
    const transientSettings = await resp.json();

    const requestedSettings = _.merge({}, transientSettings, { preferences: { currentNavItem: { name: 'Kubernetes', tab: 'environment' } } });
    const resp2 = await doRequest('/v0/transient_settings', JSON.stringify(requestedSettings), 'PUT');

    expect(resp2.ok).toBeFalsy();
    expect(resp2.status).toEqual(400);

    // Now verify that the specified values did not get updated.
    resp = await doRequest('/v0/transient_settings');
    const refreshedSettings = await resp.json();

    expect(refreshedSettings).toEqual(transientSettings);
  });

  test('should reject invalid JSON, transient settings request', async() => {
    const resp = await doRequest('/v0/transient_settings', '{"missing": "close-brace"', 'PUT');

    expect(resp.ok).toBeFalsy();
    expect(resp.status).toEqual(400);
    const body = resp.body.read().toString();

    expect(body).toContain('error processing JSON request block');
  });

  test('should reject empty payload, transient settings request', async() => {
    const resp = await doRequest('/v0/transient_settings', '', 'PUT');

    expect(resp.ok).toBeFalsy();
    expect(resp.status).toEqual(400);
    const body = resp.body.read().toString();

    expect(body).toContain('no settings specified in the request');
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
            stderr: expect.stringContaining(`Error: open ${ configFilePath }: ${ ENOENTMessage }`),
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
              stderr: expect.stringContaining(`Error: open ${ configFilePath }: ${ ENOENTMessage }`),
              stdout: '',
            });
            expect(stderr).not.toContain('Usage:');
          }
        });
        test.describe('when a non-existent config file is specified', () => {
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
                stderr: expect.stringContaining(`Error: open ${ configFile }: ${ ENOENTMessage }`),
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

      const args = ['set', '--container-engine', settings.kubernetes.containerEngine,
        `--kubernetes-enabled=${ !!settings.kubernetes.enabled }`,
        '--kubernetes-version', settings.kubernetes.version];
      const result = await rdctl(args);

      expect(result).toMatchObject({
        stderr: '',
        stdout: expect.stringContaining('Status: no changes necessary.'),
      });
    });

    test.describe('set', () => {
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
          stderr: expect.stringContaining(`Invalid value for kubernetes.containerEngine: <"${ myEngine }">; must be 'containerd', 'docker', or 'moby'`),
          stdout: '',
        });
        expect(stderr).toContain('Error: errors in attempt to update settings:');
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

      test.describe('complains when unrecognized option are given', () => {
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
          const endpoints = ['settings', '/v0/settings'];
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
            for (const endpoint of ['settings', '/v0/settings']) {
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

              for (const endpoint of ['settings', '/v0/settings']) {
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
                        stdout: expect.stringContaining('no changes necessary'),
                      });
                    });
                  }
                }
              }
            });
            test.describe('--input', () => {
              const settingsFile = path.join(paths.config, 'settings.json');

              for (const endpoint of ['settings', '/v0/settings']) {
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

              for (const endpoint of ['settings', '/v0/settings']) {
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
              const newSettings = { kubernetes: { containerEngine: 'beefalo' } };
              const { stdout, stderr, error } = await rdctl(['api', 'settings', '-b', JSON.stringify(newSettings)]);

              expect({
                stdout, stderr, error,
              }).toEqual({
                error:  expect.any(Error),
                stderr: expect.stringMatching(/errors in attempt to update settings:\s+Invalid value for kubernetes.containerEngine: <"beefalo">; must be 'containerd', 'docker', or 'moby'/),
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

      test.describe('getting endpoints', () => {
        test('no paths should return all supported endpoints', async() => {
          const { stdout, stderr } = await rdctl(['api', '/']);

          expect(stderr).toEqual('');
          expect(JSON.parse(stdout)).toEqual([
            'GET /',
            'GET /v0',
            'GET /v0/diagnostic_categories',
            'GET /v0/diagnostic_checks',
            'POST /v0/diagnostic_checks',
            'GET /v0/diagnostic_ids',
            'PUT /v0/factory_reset',
            'PUT /v0/propose_settings',
            'GET /v0/settings',
            'PUT /v0/settings',
            'PUT /v0/shutdown',
            'GET /v0/transient_settings',
            'PUT /v0/transient_settings',
          ]);
        });

        test('version-only path should return all endpoints in that version only', async() => {
          const { stdout, stderr } = await rdctl(['api', '/v0']);

          expect(stderr).toEqual('');
          expect(JSON.parse(stdout)).toEqual([
            'GET /v0',
            'GET /v0/diagnostic_categories',
            'GET /v0/diagnostic_checks',
            'POST /v0/diagnostic_checks',
            'GET /v0/diagnostic_ids',
            'PUT /v0/factory_reset',
            'PUT /v0/propose_settings',
            'GET /v0/settings',
            'PUT /v0/settings',
            'PUT /v0/shutdown',
            'GET /v0/transient_settings',
            'PUT /v0/transient_settings',
          ]);
        });
        test('/v1 should fail', async() => {
          const { stdout, stderr } = await rdctl(['api', '/v1']);

          expect({ stdout: JSON.parse(stdout), stderr: stderr.trim() }).toMatchObject({ stdout: { message: '404 Not Found' }, stderr: 'Unknown command: GET /v1' });
        });
      });

      test.describe('diagnostics', () => {
        let categories: string[];

        test('categories', async() => {
          const { stdout, stderr } = await rdctl(['api', '/v0/diagnostic_categories']);

          expect(stderr).toEqual('');
          categories = JSON.parse(stdout);
          expect(categories).toEqual(expect.arrayContaining(['Networking']));
        });
        test.skip('it finds the IDs for Utilities', async() => {
          const { stdout, stderr } = await rdctl(['api', '/v0/diagnostic_ids?category=Utilities']);

          expect(stderr).toEqual('');
          expect(JSON.parse(stdout)).toEqual(expect.arrayContaining(['RD_BIN_IN_BASH_PATH', 'RD_BIN_SYMLINKS']));
        });
        test('it finds the IDs for Networking', async() => {
          const { stdout, stderr } = await rdctl(['api', '/v0/diagnostic_ids?category=Networking']);

          expect(stderr).toEqual('');
          expect(JSON.parse(stdout)).toEqual(expect.arrayContaining(['CONNECTED_TO_INTERNET']));
        });
        test('it 404s for a non-existent category', async() => {
          const { stdout, stderr } = await rdctl(['api', '/v0/diagnostic_ids?category=cecinestpasuncategory']);

          expect({ stdout: JSON.parse(stdout), stderr: stderr.trim() }).toMatchObject({ stdout: { message: '404 Not Found' }, stderr: 'No diagnostic checks found in category cecinestpasuncategory' });
        });
        test('it finds a diagnostic check', async() => {
          const { stdout, stderr } = await rdctl(['api', '/v0/diagnostic_checks?category=Networking&id=CONNECTED_TO_INTERNET']);

          expect(stderr).toEqual('');
          expect(JSON.parse(stdout)).toMatchObject({
            checks: [{
              id:            'CONNECTED_TO_INTERNET',
              description:   'The application cannot reach the general internet for updated kubernetes versions and other components, but can still operate.',
              mute:          false,
            }],
          });
        });
        test('it finds all diagnostic checks', async() => {
          const { stdout, stderr } = await rdctl(['api', '/v0/diagnostic_checks']);

          expect(stderr).toEqual('');
          expect(JSON.parse(stdout)).toMatchObject({
            checks: expect.arrayContaining([
              {
                category:      'Networking',
                id:            'CONNECTED_TO_INTERNET',
                description:   'The application cannot reach the general internet for updated kubernetes versions and other components, but can still operate.',
                mute:          false,
                fixes:         [],
                passed:        expect.any(Boolean),
              },
            ]),
          });
        });
        test.skip('it finds all diagnostic checks for a category', async() => {
          const { stdout, stderr } = await rdctl(['api', '/v0/diagnostic_checks?category=Utilities']);

          expect(stderr).toEqual('');
          expect(JSON.parse(stdout)).toEqual({
            checks: [
              {
                category:      'Utilities',
                id:            'RD_BIN_IN_BASH_PATH',
                description:   'The ~/.rd/bin directory has not been added to the PATH, so command-line utilities are not configured in your bash shell.',
                mute:          false,
                fixes:         [
                  { description: 'You have selected manual PATH configuration. You can let Rancher Desktop automatically configure it.' },
                ],
              },
              {
                category:      'Utilities',
                id:            'RD_BIN_SYMLINKS',
                description:   'Are the files under ~/.docker/cli-plugins symlinks to ~/.rd/bin?',
                mute:          false,
                fixes:         [
                  { description: 'Replace existing files in ~/.rd/bin with symlinks to the application\'s internal utility directory.' },
                ],
              },
            ],
          });
        });
        test('it finds a diagnostic check by checkID', async() => {
          const { stdout, stderr } = await rdctl(['api', '/v0/diagnostic_checks?id=CONNECTED_TO_INTERNET']);

          expect(stderr).toEqual('');
          expect(JSON.parse(stdout)).toMatchObject({
            checks: [
              {
                category:      'Networking',
                id:            'CONNECTED_TO_INTERNET',
                description:   'The application cannot reach the general internet for updated kubernetes versions and other components, but can still operate.',
                mute:          false,
              },
            ],
          });
        });
        test('it returns an empty array for a non-existent category', async() => {
          const { stdout, stderr } = await rdctl(['api', '/v0/diagnostic_checks?category=not*a*category']);

          expect({ stdout: JSON.parse(stdout), stderr } ).toMatchObject({ stdout: { checks: [] }, stderr: '' });
        });
        test('it returns an empty array for a non-existent category with a valid ID', async() => {
          const { stdout, stderr } = await rdctl(['api', '/v0/diagnostic_checks?category=not*a*category&id=CONNECTED_TO_INTERNET']);

          expect({ stdout: JSON.parse(stdout), stderr } ).toMatchObject({ stdout: { checks: [] }, stderr: '' });
        });
        test('it returns an empty array for a non-existent checkID with a valid category', async() => {
          const { stdout, stderr } = await rdctl(['api', '/v0/diagnostic_checks?category=Utilities&id=CONNECTED_TO_INTERNET']);

          expect({ stdout: JSON.parse(stdout), stderr } ).toMatchObject({ stdout: { checks: [] }, stderr: '' });
        });
        test('it returns an empty array for a non-existent checkID when no category is specified', async() => {
          const { stdout, stderr } = await rdctl(['api', '/v0/diagnostic_checks?&id=blip']);

          expect({ stdout: JSON.parse(stdout), stderr } ).toMatchObject({ stdout: { checks: [] }, stderr: '' });
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
    test('should verify nerdctl can talk to containerd', async() => {
      const { stdout } = await rdctl(['list-settings']);
      const settings: Settings = JSON.parse(stdout);
      const payloadObject: RecursivePartial<Settings> = {};

      payloadObject.kubernetes = {};
      if (settings.kubernetes.containerEngine !== ContainerEngine.CONTAINERD) {
        payloadObject.kubernetes.containerEngine = ContainerEngine.CONTAINERD;
      }
      if (!settings.kubernetes.suppressSudo) {
        payloadObject.kubernetes.suppressSudo = true;
      }
      if (Object.keys(payloadObject.kubernetes).length > 0) {
        const navPage = new NavPage(page);

        await tool('rdctl', 'api', '/v0/settings', '--method', 'PUT', '--body', JSON.stringify(payloadObject));
        await expect(navPage.progressBar).not.toBeHidden();
        await navPage.progressBecomesReady();
        await expect(navPage.progressBar).toBeHidden();
      }
      const output = await tool('nerdctl', 'info');

      expect(output).toMatch(/Server Version:\s+v?[.0-9]+/);
    });
    test('should verify docker can talk to dockerd', async() => {
      const navPage = new NavPage(page);

      await tool('rdctl', 'set', '--container-engine', 'moby');
      await expect(navPage.progressBar).not.toBeHidden();
      await navPage.progressBecomesReady();
      await expect(navPage.progressBar).toBeHidden();
      const output = await tool('docker', 'info');

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
  // FetchError: request to http://127.0.0.1:6107/v0/set failed, reason: socket hang up
});
