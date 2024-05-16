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

import { findHomeDir } from '@kubernetes/client-node';
import { expect, test } from '@playwright/test';
import fetch from 'node-fetch';

import { NavPage } from './pages/nav-page';
import {
  getFullPathForTool, retry, startSlowerDesktop, teardown, tool,
} from './utils/TestUtils';

import { defaultSettings } from '@pkg/config/settings';
import { ServerState } from '@pkg/main/commandServer/httpCommandServer';
import { spawnFile } from '@pkg/utils/childProcess';
import paths from '@pkg/utils/paths';

import type { ElectronApplication, Page } from '@playwright/test';

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

/**
 * This function does multiple-duty:
 * 1. Skip all the tests if there is no working configured credential helper.
 * 2. Assign values to the global variables declared after the above `import` statements.
 *    This includes saving the current contents of the docker config files, to be restored at end.
 */
function haveCredentialServerHelper(): boolean {
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
      credStore = configObject.credsStore = 'none';
      fs.writeFileSync(dockerConfigPath, JSON.stringify(configObject, undefined, 2));
    }
    if (credStore === 'none') {
      return true;
    }
    const result = spawnSync(getFullPathForTool(`docker-credential-${ credStore }`), ['list'], { stdio: 'pipe' });

    return !result.error;
  } catch (err: any) {
    if (err.code === 'ENOENT' && process.env.CI) {
      try {
        console.log('Attempting to set up docker-credential-none on CI.');
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
const describeCredHelpers = credStore === 'none' ? test.describe.skip : test.describe;
const testWin32 = os.platform() === 'win32' ? test : test.skip;
const testUnix = os.platform() === 'win32' ? test.skip : test;

describeWithCreds('Credentials server', () => {
  let electronApp: ElectronApplication;
  let serverState: ServerState;
  let authString: string;
  let page: Page;
  const curlCommand = os.platform() === 'win32' ? 'curl.exe' : 'curl';
  const initialArgs: string[] = []; // Assigned once we have auth string on first use.

  async function doRequest(path: string, body = '', ignoreStderr = false) {
    const args = initialArgs.concat([`http://localhost:${ serverState.port }/${ path }`]);

    if (body.length) {
      args.push('--data', body);
    }
    const { stdout, stderr } = await spawnFile(curlCommand, args, { stdio: 'pipe' });

    if (stderr) {
      if (ignoreStderr) {
        console.log(`doRequest: spawn ${ curlCommand } ${ args.join(' ') } => ${ stderr }`);
      } else {
        expect(stderr).toEqual('');
      }
    }

    return stdout;
  }

  async function doRequestExpectStatus(path: string, body: string, expectedStatus: number) {
    const args = initialArgs.concat(['-v', `http://localhost:${ serverState.port }/${ path }`]);

    if (body.length) {
      args.push('--data', body);
    }
    const { stderr } = await spawnFile(curlCommand, args, { stdio: 'pipe' });

    expect(stderr).toContain(`HTTP/1.1 ${ expectedStatus }`);
  }

  async function addEntry(helper: string, entry: entryType): Promise<void> {
    const pathToHelper = getFullPathForTool(`docker-credential-${ helper }`);
    const body = stream.Readable.from(JSON.stringify(entry));

    await spawnFile(pathToHelper, ['store'], { stdio: [body, 'pipe', 'pipe'] });
  }

  async function listEntries(helper: string, matcher: string): Promise<Record<string, string>> {
    const pathToHelper = getFullPathForTool(`docker-credential-${ helper }`);
    const { stdout } = await spawnFile(pathToHelper, ['list'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const entries: Record<string, string> = JSON.parse(stdout);

    for (const k in entries) {
      if (!k.includes(matcher)) {
        delete entries[k];
      }
    }

    return entries;
  }

  async function removeEntries(helper: string, matcher: string) {
    const dcName = `docker-credential-${ helper }`;
    const stdout = await tool(dcName, 'list');
    const servers = Object.keys(JSON.parse(stdout));
    let finalException: any | undefined;

    for (const server of servers) {
      if (!server.includes(matcher)) {
        continue;
      }
      const body = stream.Readable.from(server);

      try {
        const pathToHelper = getFullPathForTool(dcName);
        const { stdout } = await spawnFile(pathToHelper, ['erase'], { stdio: [body, 'pipe', 'pipe'] });

        if (stdout) {
          const msg = `Problem deleting ${ server } using ${ dcName }: got output stdout: ${ stdout }`;

          console.log(msg);
          finalException ??= new Error(msg);
        }
      } catch (ex) {
        console.log(`Problem deleting ${ server } using ${ dcName }: `, ex);
        finalException ??= ex;
      }
    }
    if (finalException) {
      throw finalException;
    }
  }

  function rdctlPath() {
    return getFullPathForTool('rdctl');
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

  test.beforeAll(async({ colorScheme }, testInfo) => {
    await tool('rdctl', 'factory-reset', '--verbose');
    [electronApp, page] = await startSlowerDesktop(testInfo, { kubernetes: { enabled: false } });
  });

  test.afterAll(async() => {
    if (originalDockerConfigContents !== undefined && !process.env.CI && !process.env.RD_E2E_DO_NOT_RESTORE_CONFIG) {
      try {
        await fs.promises.writeFile(dockerConfigPath, originalDockerConfigContents);
      } catch (e: any) {
        console.error(`Failed to restore config file ${ dockerConfigPath }: `, e);
      }
    }
    if (originalPlaintextConfigContents !== undefined && !process.env.CI && !process.env.RD_E2E_DO_NOT_RESTORE_CONFIG) {
      try {
        await fs.promises.writeFile(plaintextConfigPath, originalPlaintextConfigContents);
      } catch (e: any) {
        console.error(`Failed to restore config file ${ plaintextConfigPath }: `, e);
      }
    }
  });

  test.afterAll(({ colorScheme }, testInfo) => teardown(electronApp, testInfo));

  test('should start loading the background services and hide progress bar', async() => {
    const navPage = new NavPage(page);

    await navPage.progressBecomesReady();
    await expect(navPage.progressBar).toBeHidden();
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
    const url = `http://127.0.0.1:${ serverState.port }/list`;
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

    // Don't bother trying to test erasing a nonexistent credential, because the
    // behavior is all over the place. Fails with osxkeychain, succeeds with wincred.
  });

  // On Windows, we need to wait for the vtunnel proxy to be established.
  testWin32('ensure vtunnel proxy is ready', () => {
    const isTunnel = defaultSettings.experimental.virtualMachine.networkingTunnel;

    test.skip(isTunnel, 'vtunnel process is not needed when network tunnel is enabled');
    const args = ['--distribution', 'rancher-desktop', '--exec',
      'curl', '--verbose', '--user', `${ serverState.user }:${ serverState.password }`,
      'http://localhost:3030/'];

    return retry(async() => {
      try {
        await spawnFile('wsl.exe', args);
      } catch (ex: any) {
        const curlExitReason = {
          7:  'Failed to connect to host',
          56: 'Failure in receiving network data',
        };

        if (!curlExitReason) {
          throw ex;
        }
        throw new Error(`curl failed with ${ ex } (${ curlExitReason })`);
      }
    });
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
    await expect(spawnFile(curlCommand, args, { stdio: 'pipe' })).resolves.toMatchObject({
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
      await expect(rdctlCredWithStdin('get', bobsURL)).rejects.toMatchObject({
        stdout: expect.stringContaining('credentials not found in native keychain'),
        stderr: expect.stringContaining('Error: exit status 22'),
      });
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

  // Skip these tests if config.credsStore and the credHelpers are both using 'none'
  describeCredHelpers('handles credHelpers', () => {
    const peopleEntries: Record<string, entryType> = {
      bob:     makeEntry('https://bobs.fish/clams01', 'Bob', 'clams01'),
      carol:   makeEntry('https://bobs.fish/clams02', 'Carol', 'clams02'),
      ted:     makeEntry('https://bobs.fish/clams03', 'Ted', 'clams03'),
      alice:   makeEntry('https://bobs.fish/clams04', 'Alice', 'clams04'),
      fakeTed: makeEntry('https://bobs.fish/clams03', 'Fake-Ted', 'Fake-clams03'),
    };
    const dockerConfig = {
      auths:          {},
      credsStore:     '',
      currentContext: 'rancher-desktop',
      credHelpers:    {
        'https://bobs.fish/clams03': 'none',
        'https://bobs.fish/clams05': 'none',
      },
    };
    let existingDockerConfig: Buffer | undefined;

    test.beforeAll(async() => {
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
      try {
        existingDockerConfig = await fs.promises.readFile(dockerConfigPath);
      } catch (ex) {
        if (Object(ex).code !== 'ENOENT') {
          throw ex;
        }
      }
      await fs.promises.writeFile(dockerConfigPath, JSON.stringify(dockerConfig, undefined, 2));
    });

    test.afterAll(async() => {
      if (existingDockerConfig) {
        await fs.promises.writeFile(dockerConfigPath, existingDockerConfig);
      } else {
        await fs.promises.unlink(dockerConfigPath);
      }
    });

    // removeEntries and addEntry return Promise<void>,
    // so the best we can do is assert that they don't throw an exception.

    test.beforeEach(async() => {
      await expect(removeEntries(dockerConfig.credsStore, 'https://bobs.fish/clams')).resolves.not.toThrow();
      await expect(removeEntries('none', 'https://bobs.fish/clams')).resolves.not.toThrow();
    });

    test('reading pre-populated entries through d-c-rd', async() => {
      await expect(addEntry(dockerConfig.credsStore, peopleEntries.bob)).resolves.not.toThrow();
      await expect(addEntry(dockerConfig.credsStore, peopleEntries.carol)).resolves.not.toThrow();
      await expect(addEntry('none', peopleEntries.ted)).resolves.not.toThrow();
      // These two should not be found
      await expect(addEntry('none', peopleEntries.alice)).resolves.not.toThrow();
      await expect(addEntry(dockerConfig.credsStore, peopleEntries.fakeTed)).resolves.not.toThrow();

      // Now verify that `rdctl dcrd list` gives 01 ... 03 but not Fake-Ted 03, and not 04 because it's not discoverable.

      const entries = JSON.parse(await doRequest('list'));

      expect(entries).toMatchObject({
        [peopleEntries.bob.ServerURL]:   peopleEntries.bob.Username,
        [peopleEntries.carol.ServerURL]: peopleEntries.carol.Username,
        [peopleEntries.ted.ServerURL]:   peopleEntries.ted.Username,
      });
      expect(entries).not.toMatchObject({
        [peopleEntries.alice.ServerURL]:   peopleEntries.alice.Username,
        [peopleEntries.fakeTed.ServerURL]: peopleEntries.fakeTed.Username,
      });

      // Then verify we can dcrd-get clams01, 02, and 03, but not 04 or 05
      for (const name of ['bob', 'carol', 'ted']) {
        const record = JSON.parse(await doRequest('get', peopleEntries[name].ServerURL));

        expect(record).toMatchObject(peopleEntries[name] as unknown as Record<string, string>);
      }
      if (dockerConfig.credsStore !== 'pass') {
        // TODO: Stop testing for pass once we bring in d-c-pass 0.7.0 or higher
        await expect(doRequest('get', peopleEntries.alice.ServerURL, true))
          .resolves.toEqual('credentials not found in native keychain\n');
        await expect(doRequest('get', 'https://bobs.fish/clams05', true))
          .resolves.toEqual('credentials not found in native keychain\n');
      }

      // Then dcrd-delete all of them, and verify that dcrd-list is empty.
      // But use lower-level dc helpers to show that clams04 and Fake-Ted clams03 are still around,
      // and then delete them.
      await expect(doRequest('erase', peopleEntries.bob.ServerURL)).resolves.toEqual('');
      await expect(doRequest('erase', peopleEntries.carol.ServerURL)).resolves.toEqual('');
      await expect(doRequest('erase', peopleEntries.ted.ServerURL)).resolves.toEqual('');
      // Looks like different credential-helpers handle missing erase arguments differently, so don't check results
      await doRequest('erase', peopleEntries.alice.ServerURL);
      await doRequest('erase', peopleEntries.fakeTed.ServerURL);

      const postDeleteEntries = JSON.parse(await doRequest('list'));

      expect(postDeleteEntries).not.toMatchObject({
        [peopleEntries.bob.ServerURL]:   peopleEntries.bob.Username,
        [peopleEntries.carol.ServerURL]: peopleEntries.carol.Username,
        [peopleEntries.ted.ServerURL]:   peopleEntries.ted.Username,
        [peopleEntries.alice.ServerURL]: peopleEntries.alice.Username,
      });
      await expect(listEntries(dockerConfig.credsStore, 'https://bobs.fish/clams')).resolves
        .toMatchObject({ [peopleEntries.fakeTed.ServerURL]: peopleEntries.fakeTed.Username });
      await expect(listEntries('none', 'https://bobs.fish/clams')).resolves
        .toMatchObject({ [peopleEntries.alice.ServerURL]: peopleEntries.alice.Username });
    });

    test('dcrd store uses credHelpers', async() => {
      // Use dcrd-store to store clams 01 ... 04, and show that they ended up where expected.
      // This is the inverse of the previous test.
      await doRequestExpectStatus('store', JSON.stringify(peopleEntries.bob), 200);
      await doRequestExpectStatus('store', JSON.stringify(peopleEntries.carol), 200);
      await doRequestExpectStatus('store', JSON.stringify(peopleEntries.ted), 200);
      await doRequestExpectStatus('store', JSON.stringify(peopleEntries.alice), 200);

      await expect(listEntries(dockerConfig.credsStore, 'https://bobs.fish/clams')).resolves.toMatchObject({
        [peopleEntries.bob.ServerURL]:   peopleEntries.bob.Username,
        [peopleEntries.carol.ServerURL]: peopleEntries.carol.Username,
        [peopleEntries.alice.ServerURL]: peopleEntries.alice.Username,
      });
      await expect(listEntries(dockerConfig.credsStore, 'https://bobs.fish/clams'))
        .resolves.not.toMatchObject({ [peopleEntries.ted.ServerURL]: peopleEntries.ted.Username });

      await expect(listEntries('none', 'https://bobs.fish/clams')).resolves
        .toMatchObject({ [peopleEntries.ted.ServerURL]: peopleEntries.ted.Username });
      await expect(listEntries('none', 'https://bobs.fish/clams'))
        .resolves.not.toMatchObject({
          [peopleEntries.bob.ServerURL]:   peopleEntries.bob.Username,
          [peopleEntries.carol.ServerURL]: peopleEntries.carol.Username,
          [peopleEntries.alice.ServerURL]: peopleEntries.alice.Username,
        });
    });
  });
});
