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
import { BrowserContext, ElectronApplication, Page, _electron } from 'playwright';

import fetch, { RequestInit } from 'node-fetch';
import _ from 'lodash';
import { createDefaultSettings, kubectl, packageLogs, reportAsset } from './utils/TestUtils';
import { NavPage } from './pages/nav-page';
import paths from '@/utils/paths';
import { spawnFile } from '@/utils/childProcess';
import { ServerState } from '@/main/commandServer/httpCommandServer';

test.describe('Command server', () => {
  let electronApp: ElectronApplication;
  let context: BrowserContext;
  let serverState: ServerState;
  let page: Page;
  const appPath = path.join(__dirname, '../');

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
    return path.join(appPath, 'resources', os.platform(), 'bin', os.platform() === 'win32' ? 'rdctl.exe' : 'rdctl');
  }

  async function rdctl(commandArgs: string[]): Promise< { stdout: string, stderr: string, error?: any }> {
    try {
      return await spawnFile(rdctlPath(), commandArgs, { stdio: 'pipe' });
    } catch (err: any) {
      return {
        stdout: err?.stdout ?? '', stderr: err?.stderr ?? '', error: err
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
        stdout: err?.stdout ?? '', stderr: err?.stderr ?? '', error: err
      };
    } finally {
      stream?.close();
    }
  }

  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async() => {
    createDefaultSettings();
    electronApp = await _electron.launch({
      args: [
        appPath,
        '--disable-gpu',
        '--whitelisted-ips=',
        // See src/utils/commandLine.ts before changing the next item.
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
      snapshots:   true
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
    const resp = await doRequest('/v0/settings');

    expect(resp.ok).toBeTruthy();
    expect(await resp.json()).toHaveProperty('kubernetes');
  });

  test('setting existing settings should be a no-op', async() => {
    let resp = await doRequest('/v0/settings');
    const rawSettings = resp.body.read().toString();

    resp = await doRequest('/v0/settings', rawSettings, 'PUT');
    expect(resp.ok).toBeTruthy();
    expect(resp.status).toEqual(202);
    expect(resp.body.read().toString()).toContain('no changes necessary');
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
        }
    });
    const resp2 = await doRequest('/v0/settings', JSON.stringify(requestedSettings), 'PUT');

    expect(resp2.ok).toBeFalsy();
    expect(resp2.status).toEqual(400);

    // Now verify that the specified values did not get updated.
    resp = await doRequest('/v0/settings');
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
    const resp2 = await doRequest('/v0/settings', JSON.stringify(newSettings), 'PUT');

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
    const resp = await doRequest('/v0/settings', '{"missing": "close-brace"', 'PUT');

    expect(resp.ok).toBeFalsy();
    expect(resp.status).toEqual(400);
    const body = resp.body.read().toString();

    expect(body).toContain('error processing JSON request block');
  });

  test('should reject empty payload', async() => {
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

  test.describe('rdctl', () => {
    test.describe('config-file and parameters', () => {
      test.describe("when the config-file doesn't exist", () => {
        let parameters: string[];
        const configFilePath = path.join(paths.appHome, 'rd-engine.json');
        const backupPath = path.join(paths.appHome, 'rd-engine.json.bak');
        const mvCommand = os.platform() === 'win32' ? 'ren' : 'mv';

        test.beforeAll(async() => {
          const dataRaw = await fs.promises.readFile(configFilePath, 'utf-8');

          serverState = JSON.parse(dataRaw);
          parameters = [`--password=${ serverState.password }`,
            `--port=${ serverState.port }`,
            `--user=${ serverState.user }`,
          ];
          try {
            await spawnFile(mvCommand, [configFilePath, backupPath]);
          } catch (err) {
            console.log(`Error trying to ${ mvCommand } ${ configFilePath } ${ backupPath }: `, err);
            expect(err).toBeUndefined();
          }
        });
        test.afterAll(async() => {
          try {
            await spawnFile(mvCommand, [backupPath, configFilePath]);
          } catch (err) {
            console.log(`Error trying to ${ mvCommand } ${ backupPath } ${ configFilePath }: `, err);
            expect(err).toBeUndefined();
          }
        });

        test('it complains with no parameters,', async() => {
          const { stdout, stderr, error } = await rdctl(['list-settings']);

          expect(error).toBeDefined();
          expect(stderr).toContain(`Error: open ${ configFilePath }: no such file or directory`);
          expect(stderr).not.toContain('Usage:');
          expect(stdout).toEqual('');
        });

        test('it works with all parameters,', async() => {
          const { stdout, stderr, error } = await rdctl(parameters.concat(['list-settings']));

          expect(error).toBeUndefined();
          expect(stderr).toEqual('');
          expect(stdout).toMatch(/"kubernetes":/);
          const settings = JSON.parse(stdout);

          expect(['version', 'kubernetes', 'portForwarding', 'images', 'telemetry', 'updater', 'debug', 'pathManagementStrategy']).toMatchObject(Object.keys(settings));
        });
        test("it complains when some parameters aren't specified", async() => {
          for (let idx = 0; idx < parameters.length; idx += 1) {
            const partialParameters: string[] = parameters.slice(0, idx).concat(parameters.slice(idx + 1));
            const { stdout, stderr, error } = await rdctl(partialParameters.concat(['list-settings']));

            expect(error).toBeDefined();
            expect(stderr).toContain(`Error: open ${ configFilePath }: no such file or directory`);
            expect(stderr).not.toContain('Usage:');
            expect(stdout).toEqual('');
          }
        });
        test.describe('when a non-existent config file is specified', () => {
          test('it fails even when all parameters are specified', async() => {
            let badConfigFile = '/less/salt/more/gravy.json';
            let i = 0;

            // Ensure the specified configFile doesn't exist. Give up if we have to add 100 x's to the end.
            while (i < 100) {
              try {
                await fs.promises.access(badConfigFile, fs.constants.R_OK);
                badConfigFile += 'x';
                i += 1;
              } catch {
                break;
              }
            }
            const { stdout, stderr, error } = await rdctl(parameters.concat(['list-settings', '--config-path', badConfigFile]));

            expect(error).toBeDefined();
            expect(stderr).toContain(`Error: open ${ badConfigFile }: no such file or directory`);
            expect(stderr).not.toContain('Usage:');
            expect(stdout).toEqual('');
          });
        });
      });
    });
    test('should show settings and nil-update settings', async() => {
      const { stdout, stderr, error } = await rdctl(['list-settings']);

      expect(error).toBeUndefined();
      expect(stderr).toEqual('');
      expect(stdout).toMatch(/"kubernetes":/);
      const settings = JSON.parse(stdout);

      expect(['version', 'kubernetes', 'portForwarding', 'images', 'telemetry', 'updater', 'debug', 'pathManagementStrategy']).toMatchObject(Object.keys(settings));

      const args = ['set', '--container-engine', settings.kubernetes.containerEngine,
        `--kubernetes-enabled=${ !!settings.kubernetes.enabled }`,
        '--kubernetes-version', settings.kubernetes.version];
      const result = await rdctl(args);

      expect(result.stderr).toEqual('');
      expect(result.stdout).toContain('Status: no changes necessary.');
    });

    test.describe('set', () => {
      test('complains when no args are given', async() => {
        const { stdout, stderr, error } = await rdctl(['set']);

        expect(error).toBeDefined();
        expect(stderr).toContain('Error: set command: no settings to change were given');
        expect(stderr).toContain('Usage:');
        expect(stdout).toEqual('');
      });

      test('complains when option value missing', async() => {
        const { stdout, stderr, error } = await rdctl(['set', '--container-engine']);

        expect(error).toBeDefined();
        expect(stderr).toContain('Error: flag needs an argument: --container-engine');
        expect(stderr).toContain('Usage:');
        expect(stdout).toEqual('');
      });

      test('complains when non-boolean option value specified', async() => {
        const { stdout, stderr, error } = await rdctl(['set', '--kubernetes-enabled=gorb']);

        expect(error).toBeDefined();
        expect(stderr).toContain('Error: invalid argument "gorb" for "--kubernetes-enabled" flag: strconv.ParseBool: parsing "gorb": invalid syntax');
        expect(stderr).toContain('Usage:');
        expect(stdout).toEqual('');
      });

      test('complains when invalid engine specified', async() => {
        const myEngine = 'giblets';
        const { stdout, stderr, error } = await rdctl(['set', `--container-engine=${ myEngine }`]);

        expect(error).toBeDefined();
        expect(stderr).toContain('Error: errors in attempt to update settings:');
        expect(stderr).toContain(`Invalid value for kubernetes.containerEngine: <${ myEngine }>; must be 'containerd', 'docker', or 'moby'`);
        expect(stderr).not.toContain('Usage:');
        expect(stdout).toEqual('');
      });

      test('complains when server rejects a proposed version', async() => {
        const { stdout, stderr, error } = await rdctl(['set', '--kubernetes-version=karl']);

        expect(error).toBeDefined();
        expect(stderr).toMatch(/Error: errors in attempt to update settings:\s+Kubernetes version "karl" not found./);
        expect(stderr).not.toContain('Usage:');
        expect(stdout).toEqual('');
      });
    });

    test.describe('all server commands', () => {
      test.describe('complains about unrecognized/extra arguments', () => {
        const badArgs = ['string', 'brucebean'];

        for (const cmd of ['set', 'list-settings', 'shutdown']) {
          const args = [cmd, ...badArgs];

          test(args.join(' '), async() => {
            const { stdout, stderr, error } = await rdctl(args);

            expect(error).toBeDefined();
            expect(stderr).toContain(`Error: unknown command "string" for "rdctl ${ cmd }"`);
            expect(stderr).toContain('Usage:');
            expect(stdout).toEqual('');
          });
        }
      });

      test.describe('complains when unrecognized option are given', () => {
        for (const cmd of ['set', 'list-settings', 'shutdown']) {
          const args = [cmd, '--Awop-bop-a-loo-mop', 'zips', '--alop-bom-bom=cows'];

          test(args.join(' '), async() => {
            const { stdout, stderr, error } = await rdctl(args);

            expect(error).toBeDefined();
            expect(stderr).toContain(`Error: unknown flag: ${ args[1] }`);
            expect(stderr).toContain('Usage:');
            expect(stdout).toEqual('');
          });
        }
      });
    });

    test.describe('api', () => {
      test.describe('all subcommands', () => {
        test('complains when no args are given', async() => {
          const { stdout, stderr, error } = await rdctl(['api']);

          expect(error).toBeDefined();
          expect(stderr).toContain('Error: api command: no endpoint specified');
          expect(stderr).toContain('Usage:');
          expect(stdout).toEqual('');
        });

        test('empty string endpoint should give an error message', async() => {
          const { stdout, stderr, error } = await rdctl(['api', '']);

          expect(error).toBeDefined();
          expect(stderr).toContain('Error: api command: no endpoint specified');
          expect(stderr).toContain('Usage:');
          expect(stdout).toEqual('');
        });

        test('complains when more than one endpoint is given', async() => {
          const endpoints = ['settings', '/v0/settings'];
          const { stdout, stderr, error } = await rdctl(['api', ...endpoints]);

          expect(error).toBeDefined();
          expect(stderr).toContain(`Error: api command: too many endpoints specified ([${ endpoints.join(' ') }]); exactly one must be specified`);
          expect(stderr).toContain('Usage:');
          expect(stdout).toEqual('');
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

                  expect(error).toBeUndefined();
                  expect(stderr).toEqual('');
                  const settings = JSON.parse(stdout);

                  expect(['version', 'kubernetes', 'portForwarding', 'images', 'telemetry', 'updater', 'debug', 'pathManagementStrategy']).toMatchObject(Object.keys(settings));
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

                      expect(error).toBeUndefined();
                      expect(stderr).toBe('');
                      expect(stdout).toContain('no changes necessary');
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

                      expect(error).toBeUndefined();
                      expect(stderr).toBe('');
                      expect(stdout).toContain('no changes necessary');
                    });
                  }
                }
              }
            });

            test('should complain about a "--input-" flag', async() => {
              const { stdout, stderr, error } = await rdctl(['api', '/settings', '-X', 'PUT', '--input-']);

              expect(error).toBeDefined();
              expect(stdout).toEqual('');
              expect(stderr).toContain('Error: unknown flag: --input-');
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

                      expect(error).toBeUndefined();
                      expect(stderr).toEqual('');
                      expect(stdout).toContain('no changes necessary');
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

                  expect(error).toBeDefined();
                  expect(stdout).toEqual('');
                  expect(stderr).toContain('Error: api command: --body and --input options cannot both be specified');
                  expect(stderr).toContain('Usage:');
                });
              }
            });

            test('complains when no body is provided', async() => {
              const { stdout, stderr, error } = await rdctl(['api', 'settings', '-X', 'PUT']);

              expect(error).toBeDefined();
              expect(JSON.parse(stdout)).toEqual({ message: '400 Bad Request' });
              expect(stderr).not.toContain('Usage:');
              expect(stderr).toContain('no settings specified in the request');
            });

            test('invalid setting is specified', async() => {
              const newSettings = { kubernetes: { containerEngine: 'beefalo' } };
              const { stdout, stderr, error } = await rdctl(['api', 'settings', '-b', JSON.stringify(newSettings)]);

              expect(error).toBeDefined();
              expect(JSON.parse(stdout)).toEqual({ message: '400 Bad Request' } );
              expect(stderr).not.toContain('Usage:');
              expect(stderr).toMatch(/errors in attempt to update settings:\s+Invalid value for kubernetes.containerEngine: <beefalo>; must be 'containerd', 'docker', or 'moby'/);
            });
          });
        });
      });

      test('complains on invalid endpoint', async() => {
        const endpoint = '/v99/no/such/endpoint';
        const { stdout, stderr, error } = await rdctl(['api', endpoint]);

        expect(error).toBeDefined();
        expect(JSON.parse(stdout)).toEqual({ message: '404 Not Found' });
        expect(stderr).not.toContain('Usage:');
        expect(stderr).toContain(`Unknown command: GET ${ endpoint }`);
      });

      test.describe('getting endpoints', () => {
        test('no paths should return all supported endpoints', async() => {
          const { stdout, stderr } = await rdctl(['api', '/']);

          expect(stderr).toEqual('');
          expect(JSON.parse(stdout)).toEqual([
            'GET /',
            'GET /v0',
            'GET /v0/settings',
            'PUT /v0/settings',
            'PUT /v0/shutdown',
          ]);
        });

        test('version-only path should return all endpoints in that version only', async() => {
          const { stdout, stderr } = await rdctl(['api', '/v0']);

          expect(stderr).toEqual('');
          expect(JSON.parse(stdout)).toEqual([
            'GET /v0',
            'GET /v0/settings',
            'PUT /v0/settings',
            'PUT /v0/shutdown',
          ]);
        });
      });
    });
    test.describe('shell', () => {
      test('can run echo', async() => {
        const { stdout, stderr, error } = await rdctl(['shell', 'echo', 'abc', 'def']);

        expect(error).toBeUndefined();
        expect(stderr).toEqual('');
        expect(stdout.trim()).toEqual('abc def');
      });
      test('can run a command with a dash-option', async() => {
        const { stdout, stderr, error } = await rdctl(['shell', 'uname', '-a']);

        expect(error).toBeUndefined();
        expect(stderr).toEqual('');
        expect(stdout.trim()).not.toEqual('');
      });
      test('can run a shell', async() => {
        const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rdctl-shell-input'));
        const inputPath = path.join(tmpDir, 'echo.txt');

        try {
          await fs.promises.writeFile(inputPath, 'echo orate linds chump\n');
          const { stdout, stderr, error } = await rdctlWithStdin(inputPath, ['shell']);

          expect(error).toBeUndefined();
          expect(stderr).toBe('');
          expect(stdout).toContain('orate linds chump');
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
  // FetchError: request to http://127.0.0.1:6107/v0/set failed, reason: socket hang up
});
