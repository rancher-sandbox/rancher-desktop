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
import stream from 'stream';
import { spawnSync } from 'child_process';

import fetch from 'node-fetch';
import { expect, test } from '@playwright/test';
import { BrowserContext, ElectronApplication, Page, _electron } from 'playwright';

import { createDefaultSettings, packageLogs, reportAsset } from './utils/TestUtils';
import { NavPage } from './pages/nav-page';
import paths from '@/utils/paths';
import { ServerState } from '@/main/commandServer/httpCommandServer';
import { spawnFile } from '@/utils/childProcess';
import { findHomeDir } from '@/config/findHomeDir';
import * as crypto from 'crypto';

// If credsStore is `none` there's no need to test that the helper is available in advance: we want
// the tests to fail if it isn't available.
function haveCredentialServerHelper(): boolean {
  // Not using the code from `httpCredentialServer.ts` because we can't use async code at top-level here.
  const homeDir = findHomeDir() ?? '/';
  const dockerDir = path.join(homeDir, '.docker');
  const dockerConfigPath = path.join(dockerDir, 'config.json');

  try {
    const contents = JSON.parse(fs.readFileSync(dockerConfigPath).toString());
    const credStore = contents.credsStore;

    if (!credStore) {
      if (process.env.CIRRUS_CI) {
        contents.credsStore = 'none';
        fs.writeFileSync(dockerConfigPath, JSON.stringify(contents, undefined, 2));

        return true;
      }

      return false;
    }
    if (credStore === 'none') {
      return true;
    }
    const result = spawnSync(`docker-credential-${ credStore }`, ['list'], { stdio: 'pipe' });

    return !result.error;
  } catch (err: any) {
    if (err.code === 'ENOENT' && process.env.CIRRUS_CI) {
      try {
        console.log('Attempting to set up docker-credential-none on CIRRUS CI.');
        fs.mkdirSync(dockerDir, { recursive: true });
        fs.writeFileSync(dockerConfigPath, JSON.stringify({ credsStore: 'none' }, undefined, 2));

        return true;
      } catch (err2: any) {
        console.log(`Failed to create a .docker/config.json on the fly for CI: stdout: ${ err2.stdout?.toString() }, stderr: ${ err2.stderr?.toString() }`);
      }
    }

    return false;
  }
}

const describeWithCreds = haveCredentialServerHelper() ? test.describe : test.describe.skip;

describeWithCreds('Credentials server', () => {
  let electronApp: ElectronApplication;
  let context: BrowserContext;
  let serverState: ServerState;
  let authString: string;
  let page: Page;
  const appPath = path.join(__dirname, '../');
  const command = os.platform() === 'win32' ? 'curl.exe' : 'curl';
  const initialArgs: string[] = []; // Assigned once we have auth string on first use.

  async function doRequest(path: string, body = '') {
    const args = initialArgs.concat([`http://localhost:${ serverState.port }/${ path }`]);

    if (body.length) {
      args.push('--data', body);
    }
    const { stdout, stderr } = await spawnFile(command, args, { stdio: 'pipe' });

    expect(stderr).toEqual('');

    return stdout;
  }

  async function doRequestExpectStatus(path: string, body: string, expectedStatus: number) {
    const args = initialArgs.concat(['-v', `http://localhost:${ serverState.port }/${ path }`]);

    if (body.length) {
      args.push('--data', body);
    }
    const { stderr } = await spawnFile(command, args, { stdio: 'pipe' });

    expect(stderr).toContain(`HTTP/1.1 ${ expectedStatus }`);
  }

  function rdctlPath() {
    return path.join(appPath, 'resources', os.platform(), 'bin', os.platform() === 'win32' ? 'rdctl.exe' : 'rdctl');
  }

  async function rdctlCredWithStdin(command: string, input?: string): Promise<{ stdout: string, stderr: string }> {
    try {
      const body = stream.Readable.from(input ?? '');
      const args = ['shell', '/usr/local/bin/docker-credential-rancher-desktop'].concat([command]);

      return await spawnFile(rdctlPath(), args, { stdio: [body, 'pipe', 'pipe'] });
    } catch (err: any) {
      throw {
        stdout: err?.stdout ?? '',
        stderr: err?.stderr ?? '',
        error:  err
      };
    }
  }

  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async() => {
    createDefaultSettings({ kubernetes: { enabled: false } });
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

  test('should emit connection information', async() => {
    const dataPath = path.join(paths.appHome, 'credential-server.json');
    const dataRaw = await fs.promises.readFile(dataPath, 'utf-8');

    serverState = JSON.parse(dataRaw);
    expect(typeof serverState.user).toBe('string');
    expect(typeof serverState.password).toBe('string');
    expect(typeof serverState.port).toBe('number');
    expect(typeof serverState.pid).toBe('number');

    // Now is a good time to initialize the various connection-related values.
    authString = `${ serverState.user }:${ serverState.password }`;
    // common arguments for curl
    initialArgs.push('--silent', '--user', authString, '--request', 'POST');
  });

  test('should require authentication', async() => {
    const url = `http://localhost:${ serverState.port }/list`;
    const resp = await fetch(url);

    expect(resp.ok).toBeFalsy();
    expect(resp.status).toEqual(401);
  });

  test('should be able to use the API', async() => {
    const bobsURL = 'https://bobs.fish/tackle';
    const bobsFirstSecret = 'loblaw';
    const bobsSecondSecret = 'shoppers with spaces and % and \' and &s';

    const body = {
      ServerURL: bobsURL, Username: 'bob', Secret: bobsFirstSecret
    };
    let stdout: string = await doRequest('list');

    if (JSON.parse(stdout)[bobsURL]) {
      await doRequestExpectStatus('erase', bobsURL, 200);
    }

    await doRequestExpectStatus('store', JSON.stringify(body), 200);

    stdout = await doRequest('list');
    expect(JSON.parse(stdout)).toMatchObject({ [bobsURL]: 'bob' });

    stdout = await doRequest('get', bobsURL);
    expect(JSON.parse(stdout)).toMatchObject(body);

    // Verify we can store and retrieve passwords with wacky characters in them.
    body.Secret = bobsSecondSecret;
    await doRequestExpectStatus('store', JSON.stringify(body), 200);

    stdout = await doRequest('get', bobsURL);
    expect(JSON.parse(stdout)).toMatchObject(body);

    await doRequestExpectStatus('erase', bobsURL, 200);

    stdout = await doRequest('get', bobsURL);
    expect(stdout).toContain('credentials not found in native keychain');

    // Don't bother trying to test erasing a non-existent credential, because the
    // behavior is all over the place. Fails with osxkeychain, succeeds with wincred.
  });

  test('should start loading the background services and hide progress bar', async() => {
    const navPage = new NavPage(page);

    await navPage.progressBecomesReady();
    await expect(navPage.progressBar).toBeHidden();
  });

  test('should be able to use the script', async() => {
    const bobsURL = 'https://bobs.fish/tackle';
    const bobsFirstSecret = 'loblaw';
    const bobsSecondSecret = 'shoppers with spaces and % and \' and &s and even a 😱';

    const body = {
      ServerURL: bobsURL,
      Username:  'bob',
      Secret:    bobsFirstSecret
    };

    let { stdout } = await rdctlCredWithStdin('list');

    if (stdout && JSON.parse(stdout)[bobsURL]) {
      ({ stdout } = await rdctlCredWithStdin('erase', bobsURL));
      expect(stdout).toEqual('');
    }

    await expect(rdctlCredWithStdin('store', JSON.stringify(body))).resolves.toMatchObject({ stdout: '' });

    ({ stdout } = await rdctlCredWithStdin('list'));
    expect(JSON.parse(stdout)).toMatchObject({ [bobsURL]: 'bob' });

    ({ stdout } = await rdctlCredWithStdin('get', bobsURL));
    expect(JSON.parse(stdout)).toMatchObject(body);

    // Verify we can store and retrieve passwords with wacky characters in them.
    body.Secret = bobsSecondSecret;
    await expect(rdctlCredWithStdin('store', JSON.stringify(body))).resolves.toMatchObject({ stdout: '' });

    ({ stdout } = await rdctlCredWithStdin('get', bobsURL));
    expect(JSON.parse(stdout)).toMatchObject(body);

    await expect(rdctlCredWithStdin('erase', bobsURL)).resolves.toMatchObject({ stdout: '' });

    await expect(rdctlCredWithStdin('get', bobsURL)).rejects.toMatchObject({
      stdout: expect.stringContaining('credentials not found in native keychain'),
      stderr: expect.stringContaining('Error: exit status 22'),
    });

  test('complains when the limit is exceeded (on the sever)', async() => {
    const args = [
      'shell',
      'bash',
      '-c',
      `source /etc/rancher/desktop/credfwd; \
       DATA="@-"; \
       SECRET=$(tr -dc 'A-Za-z0-9,._=' < /dev/urandom |  head -c5242880); \
       echo '{"ServerURL":"https://example.com/v1","Username":"bob","Secret":"'$SECRET'"}' |
         curl --silent --show-error --user "$CREDFWD_AUTH" --data "$DATA" --noproxy '*' --fail-with-body "$CREDFWD_URL/store"
      `
    ];

    try {
      // This should throw, but we care about more than one error field, so use a try-catch
      const { stdout } = await spawnFile(rdctlPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });

      expect(stdout).toEqual('should have failed');
    } catch (err: any) {
      expect(err).toMatchObject({
        stdout: expect.stringContaining('request body is too long, request body size exceeds 4194304'),
        stderr: expect.stringContaining('The requested URL returned error: 413\nError: exit status 22')
      });
    }
  });

  test('handles long but legal payloads (generated on the sever)', async() => {
    const calsURL = 'https://cals.nightcrawlers.com/guaranteed';
    const keyLength = 5000;
    const secret = crypto.randomBytes(keyLength / 2).toString('hex');
    const args = [
      'shell',
      'bash',
      '-c',
      `source /etc/rancher/desktop/credfwd; \
       DATA="@-"; \
       echo '{"ServerURL":"'${ calsURL }'","Username":"bob","Secret":"${ secret }"}' |
         curl --silent --show-error --user "$CREDFWD_AUTH" --data "$DATA" --noproxy '*' --fail-with-body "$CREDFWD_URL/store"
      `
    ];

    await expect(spawnFile(rdctlPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] })).resolves.toBeDefined();
    const { stdout } = await rdctlCredWithStdin('get', calsURL);

    expect(JSON.parse(stdout).Secret).toEqual(secret);
  });

  test.describe('should be able to detect errors', () => {
    const bobsURL = 'https://bobs.fish/bait';

    test('it should complain when no ServerURL is given', async() => {
      const body: Record<string, string> = {};

      await expect(rdctlCredWithStdin('store', JSON.stringify(body))).rejects.toMatchObject({
        stdout: expect.stringContaining('no credentials server URL'),
        stderr: expect.stringContaining('Error: exit status 22'),
      });
    });

    test('it should complain when no username is given', async() => {
      const body: Record<string, string> = { ServerURL: bobsURL };

      await expect(rdctlCredWithStdin('store', JSON.stringify(body))).rejects.toMatchObject({
        stdout: expect.stringContaining('no credentials username'),
        stderr: expect.stringContaining('Error: exit status 22'),
      });
    });

    test('it should not complain about extra fields', async() => {
      const body: Record<string, string> = {
        ServerURL: bobsURL, Username: 'bob', Soup: 'gazpacho'
      };

      await expect(rdctlCredWithStdin('store', JSON.stringify(body))).resolves.toMatchObject({
        stdout: '',
        stderr: '',
      });

      const { stdout, stderr } = await rdctlCredWithStdin('get', bobsURL);

      expect({ stdout: JSON.parse(stdout), stderr }).toMatchObject({
        // Playwright type definitions for `expect.not` is missing; see
        // playwright issue #15087.
        stdout: (expect as any).not.objectContaining({ Soupt: 'gazpacho' }),
        stderr: '',
      });
    });
  });
});
