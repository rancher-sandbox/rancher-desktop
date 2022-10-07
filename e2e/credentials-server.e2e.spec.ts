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

import { spawnSync } from 'child_process';
import * as crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import process from 'process';
import stream from 'stream';
import util from 'util';

import { expect, test } from '@playwright/test';
import fetch from 'node-fetch';
import { BrowserContext, ElectronApplication, Page, _electron } from 'playwright';

import { NavPage } from './pages/nav-page';
import { createDefaultSettings, packageLogs, reportAsset } from './utils/TestUtils';

import { findHomeDir } from '@/config/findHomeDir';
import { ServerState } from '@/main/commandServer/httpCommandServer';
import { spawnFile } from '@/utils/childProcess';
import paths from '@/utils/paths';
let credStore = '';
let dockerConfigPath = '';
let originalDockerConfigContents: string|undefined;
let plaintextConfigPath = '';
let originalPlaintextConfigContents: string|undefined;

interface entryType {
  ServerURL: string;
  Username: string;
  Secret: string;
}

function makeEntry(url: string, username: string, secret: string): entryType {
  return {
    ServerURL: url, Username: username, Secret: secret,
  };
}

// If credsStore is `none` there's no need to test that the helper is available in advance: we want
// the tests to fail if it isn't available.
function haveCredentialServerHelper(): boolean {
  // Not using the code from `httpCredentialServer.ts` because we can't use async code at top-level here.
  const homeDir = findHomeDir() ?? '/';
  const dockerDir = path.join(homeDir, '.docker');

  dockerConfigPath = path.join(dockerDir, 'config.json');
  plaintextConfigPath = path.join(dockerDir, 'plaintext-credentials.config.json');
  try {
    originalPlaintextConfigContents = fs.readFileSync(plaintextConfigPath).toString();
  } catch { }
  try {
    originalDockerConfigContents = fs.readFileSync(dockerConfigPath).toString();
    const configObject = JSON.parse(originalDockerConfigContents);

    credStore = configObject.credsStore;
    if (!credStore) {
      if (process.env.CIRRUS_CI) {
        configObject.credsStore = 'none';
        fs.writeFileSync(dockerConfigPath, JSON.stringify(configObject, undefined, 2));

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
const testWin32 = os.platform() === 'win32' ? test : test.skip;
const testUnix = os.platform() === 'win32' ? test.skip : test;

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
      const args = ['shell', 'sh', '-c', `CREDFWD_CURL_OPTS=--show-error /usr/local/bin/docker-credential-rancher-desktop ${ command }`];

      return await spawnFile(rdctlPath(), args, { stdio: [body, 'pipe', 'pipe'] });
    } catch (err: any) {
      throw {
        stdout: err?.stdout ?? '',
        stderr: err?.stderr ?? '',
        error:  err,
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
      snapshots:   true,
    });
    page = await electronApp.firstWindow();
  });

  test.afterAll(async() => {
    await context.tracing.stop({ path: reportAsset(__filename) });
    await packageLogs(__filename);
    await electronApp.close();

    if (originalDockerConfigContents !== undefined && !process.env.CIRRUS_CI && !process.env.RD_E2E_DO_NOT_RESTORE_CONFIG) {
      try {
        await fs.promises.writeFile(dockerConfigPath, originalDockerConfigContents);
      } catch (e: any) {
        console.error(`Failed to restore config file ${ dockerConfigPath }: `, e);
      }
    }
    if (originalPlaintextConfigContents !== undefined && !process.env.CIRRUS_CI && !process.env.RD_E2E_DO_NOT_RESTORE_CONFIG) {
      try {
        await fs.promises.writeFile(plaintextConfigPath, originalPlaintextConfigContents);
      } catch (e: any) {
        console.error(`Failed to restore config file ${ plaintextConfigPath }: `, e);
      }
    }
  });

  test('should emit connection information', async() => {
    const dataPath = path.join(paths.appHome, 'credential-server.json');
    const dataRaw = await fs.promises.readFile(dataPath, 'utf-8');

    serverState = JSON.parse(dataRaw);
    expect(serverState).toEqual(expect.objectContaining({
      user:     expect.any(String),
      password: expect.any(String),
      port:     expect.any(Number),
      pid:      expect.any(Number),
    }));

    // Check if the process is running.
    try {
      expect(process.kill(serverState.pid, 0)).toBeTruthy();
    } catch (ex: any) {
      // Exception here is acceptable, if the error is due to EPERM.
      expect(ex).toHaveProperty('code', 'EPERM');
    }

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
      ServerURL: bobsURL, Username: 'bob', Secret: bobsFirstSecret,
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

    // Instead of returning an error message,
    // `docker-credential-pass` will happily return an object with `ServerURL` set to the provided argument,
    // and empty strings for Username and Secret.
    // This is a bit crazy, because `pass show noSuchEntry` gives an error message.
    // Upstream error: https://github.com/docker/docker-credential-helpers/issues/220
    if (credStore !== 'pass') {
      stdout = await doRequest('get', bobsURL);
      expect(stdout).toContain('credentials not found in native keychain');
    }

    // Don't bother trying to test erasing a non-existent credential, because the
    // behavior is all over the place. Fails with osxkeychain, succeeds with wincred.
  });

  test('should start loading the background services and hide progress bar', async() => {
    const navPage = new NavPage(page);

    await navPage.progressBecomesReady();
    await expect(navPage.progressBar).toBeHidden();
  });

  // On Windows, we need to wait for the vtunnel proxy to be established.
  testWin32('ensure vtunnel proxy is ready', async() => {
    const args = ['--distribution', 'rancher-desktop', '--exec',
      'curl', '--verbose', '--user', `${ serverState.user }:${ serverState.password }`,
      'http://localhost:3030/'];

    for (let attempt = 0; attempt < 30; ++attempt) {
      try {
        await spawnFile('wsl.exe', args);
        break;
      } catch (ex: any) {
        if (ex.code !== 56) {
          throw ex;
        }
        console.debug(`Attempt ${ attempt } failed with ${ ex }, retrying...`);
        await util.promisify(setTimeout)(1_000);
      }
    }
  });

  test('it should complain about an unrecognized command', async() => {
    const badCommand = 'gazornaanplatt';
    const stdout = await doRequest(badCommand);

    expect(stdout).toContain(`Unknown credential action '${ badCommand }' for the credential-server, must be one of [erase|get|list|store]`);
  });

  test('it should complain about non-POST requests', async() => {
    const args = initialArgs.concat([`http://localhost:${ serverState.port }/list`]);
    const postIndex = args.indexOf('POST');

    if (postIndex > -1) {
      args.splice(postIndex - 1, 2);
    }
    await expect(spawnFile(command, args, { stdio: 'pipe' })).resolves.toMatchObject({
      stdout: expect.stringContaining('Expecting a POST method for the credential-server list request, received GET'),
      stderr: '',
    });
  });

  test('should be able to use the script', async() => {
    const bobsURL = 'https://bobs.fish/tackle';
    const bobsFirstSecret = 'loblaw';
    const bobsSecondSecret = 'shoppers with spaces and % and \' and &s and even a 😱';

    const body = {
      ServerURL: bobsURL,
      Username:  'bob',
      Secret:    bobsFirstSecret,
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

    if (credStore !== 'pass') {
      // See above comment discussing the consequences of `echo ARG | docker-credential-pass get` never failing.
      await expect(rdctlCredWithStdin('erase', bobsURL)).resolves.toMatchObject({ stdout: '' });
      if (credStore === 'none') {
        await expect(rdctlCredWithStdin('get', bobsURL)).resolves.toMatchObject({
          stdout: expect.stringContaining('credentials not found in native keychain'),
          stderr: '',
        });
      } else {
        await expect(rdctlCredWithStdin('get', bobsURL)).rejects.toMatchObject({
          stdout: expect.stringContaining('credentials not found in native keychain'),
          stderr: expect.stringContaining('Error: exit status 22'),
        });
      }
    }
  });

  // This test currently fails on Windows due to https://github.com/docker/docker-credential-helpers/issues/190
  testUnix('complains when the limit is exceeded (on the server - do an inexact check)', async() => {
    const args = [
      'shell',
      'sh',
      '-c',
      `export CREDFWD_CURL_OPTS="--show-error"; \
       SECRET=$(tr -dc 'A-Za-z0-9,._=' < /dev/urandom |  head -c5242880); \
       echo '{"ServerURL":"https://example.com/v1","Username":"alice","Secret":"'$SECRET'"}' |
         /usr/local/bin/docker-credential-rancher-desktop store`,
    ];

    try {
      // This should throw, but we care about more than one error field, so use a try-catch
      const { stdout } = await spawnFile(rdctlPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });

      expect(stdout).toEqual('should have failed');
    } catch (err: any) {
      expect(err).toMatchObject({
        stdout: expect.stringContaining('request body is too long, request body size exceeds 4194304'),
        stderr: expect.stringContaining('The requested URL returned error: 413\nError: exit status 22'),
      });
    }
  });

  // This test currently fails on Windows due to https://github.com/docker/docker-credential-helpers/issues/190
  testUnix('handles long, legal payloads that can be verified', async() => {
    const calsURL = 'https://cals.nightcrawlers.com/guaranteed';
    const keyLength = 5000;
    const secret = crypto.randomBytes(keyLength / 2).toString('hex');
    const args = [
      'shell',
      'sh',
      '-c',
      `echo '{"ServerURL":"${ calsURL }","Username":"cal","Secret":"${ secret }"}' |
         /usr/local/bin/docker-credential-rancher-desktop store`,
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
        ServerURL: bobsURL, Username: 'bob', Soup: 'gazpacho',
      };

      await expect(rdctlCredWithStdin('store', JSON.stringify(body))).resolves.toMatchObject({ stdout: '' });

      const { stdout, stderr } = await rdctlCredWithStdin('get', bobsURL);

      expect({ stdout: JSON.parse(stdout), stderr }).toMatchObject({
        // Playwright type definitions for `expect.not` is missing; see
        // playwright issue #15087.
        stdout: (expect as any).not.objectContaining({ Soup: 'gazpacho' }),
      });
    });
  });

  test.describe('handles credHelpers', () => {
    let people: Record<string, entryType> = {};

    test.beforeAll(async() => {
      const dockerConfig = {
        auths:          {},
        credsStore:     '',
        currentContext: 'rancher-desktop',
        credHelpers:    {},
      };
      const platform = os.platform();

      if (platform.startsWith('win')) {
        dockerConfig.credsStore = 'wincred';
      } else if (platform === 'darwin') {
        dockerConfig.credsStore = 'osxkeychain';
      } else if (platform === 'linux') {
        dockerConfig.credsStore = 'pass';
      } else {
        throw new Error(`Unexpected platform of ${ platform }`);
      }
      // Easier to test if all secrets start with 'the '
      people = {
        bob:   makeEntry('https://bobs.lobster/claw', 'loblaw', 'the pincer'),
        carol: makeEntry('https://carols.clam/shell', 'safeway', 'the hinge'),
        ted:   makeEntry('https://teds.flounder/fin', 'qfc', 'the eyes'),
        alice: makeEntry('https://alices.starfish/shell', 'fred meyers', 'the feet'),
      };

      dockerConfig.credHelpers = {
        [people.ted.ServerURL]:   'none',
        [people.alice.ServerURL]: dockerConfig.credsStore,
      };

      await fs.promises.writeFile(dockerConfigPath, JSON.stringify(dockerConfig, undefined, 2));

      for (const record of Object.values(people)) {
        await expect(rdctlCredWithStdin('store', JSON.stringify(record)))
          .resolves.toMatchObject({ stdout: '' });
      }
    });

    test('uses credHelpers', async() => {
      let { stdout } = await rdctlCredWithStdin('list');

      expect(JSON.parse(stdout)).toMatchObject({
        [people.bob.ServerURL]:   people.bob.Username,
        [people.carol.ServerURL]: people.carol.Username,
        [people.ted.ServerURL]:   people.ted.Username,
        [people.alice.ServerURL]: people.alice.Username,
      });

      const plainTextConfig = await fs.promises.readFile(plaintextConfigPath, 'utf8');
      let config = JSON.parse(plainTextConfig);

      expect(config.auths).toMatchObject({
        [people.ted.ServerURL]:
          { auth: Buffer.from(`${ people.ted.Username }:${ people.ted.Secret }`).toString('base64') },
      });
      expect([people.bob.ServerURL, people.carol.ServerURL, people.alice.ServerURL]).toEqual(
        expect.not.arrayContaining(Object.keys(config.auths)),
      );

      // Verify we can get everyone, either via helpers or the credsStore
      for (const name in people) {
        const { stdout } = await rdctlCredWithStdin('get', people[name].ServerURL);

        config = JSON.parse(stdout);
        expect(config).toMatchObject(people[name] as unknown as Record<string, string>);
        // sanity-check
        expect(config.Secret).toMatch(/^the /);
      }

      // Now delete ted and alice, and verify ted is removed from the plaintext auths
      await expect(rdctlCredWithStdin('erase', people.ted.ServerURL)).resolves
        .toMatchObject({ stdout: '', stderr: '' });
      await expect(rdctlCredWithStdin('erase', people.alice.ServerURL)).resolves
        .toMatchObject({ stdout: '', stderr: '' });

      ({ stdout } = await rdctlCredWithStdin('list'));
      config = JSON.parse(stdout);
      expect(config).toMatchObject({
        [people.bob.ServerURL]:   people.bob.Username,
        [people.carol.ServerURL]: people.carol.Username,
      });
      expect([people.ted.ServerURL, people.alice.ServerURL]).toEqual(
        expect.not.arrayContaining(Object.keys(config)),
      );
      // remove the others
      await expect(rdctlCredWithStdin('erase', people.bob.ServerURL)).resolves
        .toMatchObject({ stdout: '', stderr: '' });
      await expect(rdctlCredWithStdin('erase', people.carol.ServerURL)).resolves
        .toMatchObject({ stdout: '', stderr: '' });
    });
  });
});
