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
import util from 'util';
import { spawnSync } from 'child_process';

import { expect, test } from '@playwright/test';
import { BrowserContext, ElectronApplication, Page, _electron } from 'playwright';

import fetch from 'node-fetch';
import { createDefaultSettings, playwrightReportAssets } from './utils/TestUtils';
import paths from '@/utils/paths';
import { ServerState } from '@/main/commandServer/httpCommandServer';
import { wslHostIPv4Address } from '@/utils/networks';
import { spawnFile } from '@/utils/childProcess';
import { findHomeDir } from '@/config/findHomeDir';

function haveCredentialServerHelper(): boolean {
  // Not using the code from `httpCredentialServer.ts` because we can't use async code at top-level here.
  const dockerConfigPath = path.join(findHomeDir() ?? '', '.docker', 'config.json');

  try {
    const contents = JSON.parse(fs.readFileSync(dockerConfigPath).toString());
    const credStore = contents.credsStore;

    if (!credStore) {
      return false;
    }
    const result = spawnSync(`docker-credential-${ credStore }`, { input: 'list', stdio: 'pipe' });

    return !result.error;
  } catch (err: any) {
    return false;
  }
}

const describeWithCreds = haveCredentialServerHelper() ? test.describe : test.skip;

describeWithCreds('Credentials server', () => {
  let electronApp: ElectronApplication;
  let context: BrowserContext;
  let serverState: ServerState;
  let authString: string;
  let page: Page;
  const appPath = path.join(__dirname, '../');
  const command = os.platform() === 'win32' ? 'wsl' : 'curl';
  // Assign these values on first request once we have an authString
  // And we can't assign to ipaddr on Windows here because we need an async context.
  let ipaddr: string|undefined = '';
  let initialArgs: string[] = [];

  async function doRequest(path: string, body = '') {
    const args = initialArgs.concat([`http://${ ipaddr }:${ serverState.port }/${ path }`]);

    if (body.length) {
      args.push('--data', body);
    }
    const { stdout, stderr } = await spawnFile(command, args, { stdio: 'pipe' });

    expect(stderr).toEqual('');

    return stdout;
  }

  function rdctlPath() {
    return path.join(appPath, 'resources', os.platform(), 'bin', os.platform() === 'win32' ? 'rdctl.exe' : 'rdctl');
  }

  async function rdctlCred(...commandArgs: string[]): Promise<{ stdout: string, stderr: string, error?: any }> {
    try {
      const args = ['shell', '/bin/sh', '-ex', '/usr/local/bin/docker-credential-rancher-desktop'].concat(commandArgs);

      return await spawnFile(rdctlPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err: any) {
      return {
        stdout: err?.stdout ?? '',
        stderr: err?.stderr ?? '',
        error:  err
      };
    }
  }

  async function rdctlCredWithStdin(command: string, ...commandArgs: string[]): Promise<{ stdout: string, stderr: string, error?: any }> {
    try {
      const input = commandArgs[0] ?? '';
      const body = stream.Readable.from(input);
      const args = ['shell', '/usr/local/bin/docker-credential-rancher-desktop'].concat([command]);

      return await spawnFile(rdctlPath(), args, { stdio: [body, 'pipe', 'pipe'] });
    } catch (err: any) {
      return {
        stdout: err?.stdout ?? '',
        stderr: err?.stderr ?? '',
        error:  err
      };
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
      ]
    });
    context = electronApp.context();

    await context.tracing.start({
      screenshots: true,
      snapshots:   true
    });
    page = await electronApp.firstWindow();
  });

  test.afterAll(async() => {
    await context.tracing.stop({ path: playwrightReportAssets(path.basename(__filename)) });
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
    if (os.platform() === 'win32') {
      ipaddr = await wslHostIPv4Address();
      if (!ipaddr) {
        throw new Error('Failed to get the WSL IP address');
      }
      // arguments for wsl
      initialArgs = ['--distribution', 'rancher-desktop', '--exec', 'curl'];
    } else {
      ipaddr = 'localhost';
    }
    // common arguments for curl
    initialArgs = initialArgs.concat(['--silent', '--user', authString, '--request', 'POST']);
  });

  test('should require authentication', async() => {
    const url = `http://${ ipaddr }:${ serverState.port }/list`;
    const resp = await fetch(url);

    expect(resp.ok).toBeFalsy();
    expect(resp.status).toEqual(401);
  });

  test('should be able to use the API', async() => {
    const bobsURL = 'https://bobs.fish/tackle';
    const bobsFirstSecret = 'loblaw';
    const bobsSecondSecret = 'shoppers with spaces and % and \' and &s and even a 😱';

    const body = {
      ServerURL: bobsURL, Username: 'bob', Secret: bobsFirstSecret
    };
    let stdout: string = await doRequest('list');

    if (JSON.parse(stdout)[bobsURL]) {
      stdout = await doRequest('erase', bobsURL);
      expect(stdout).toEqual('');
    }

    stdout = await doRequest('store', JSON.stringify(body));
    expect(stdout).toEqual('');

    stdout = await doRequest('list');
    expect(JSON.parse(stdout)).toMatchObject({ [bobsURL]: 'bob' } );

    stdout = await doRequest('get', bobsURL);
    expect(JSON.parse(stdout)).toMatchObject(body);

    // Verify we can store and retrieve passwords with wacky characters in them.
    body.Secret = bobsSecondSecret;
    stdout = await doRequest('store', JSON.stringify(body));
    expect(stdout).toBe('');

    stdout = await doRequest('get', bobsURL);
    expect(JSON.parse(stdout)).toMatchObject(body);

    stdout = await doRequest('erase', bobsURL);
    expect(stdout).toBe('');

    stdout = await doRequest('get', bobsURL);
    expect(stdout).toContain('credentials not found in native keychain');

    stdout = await doRequest('erase', bobsURL);
    expect(stdout).toContain('The specified item could not be found in the keychain');
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

    // TODO: Replace this with `rdctl status... something something RUNNING` once it's available
    await util.promisify(setTimeout)(50_000);
    let { stdout } = await rdctlCred('list');

    if (JSON.parse(stdout)[bobsURL]) {
      ({ stdout } = await rdctlCred('erase', bobsURL));
      expect(stdout).toEqual('');
    }

    ({ stdout } = await rdctlCred('store', JSON.stringify(body)));
    expect(stdout).toEqual('');

    ({ stdout } = await rdctlCred('list'));
    expect(JSON.parse(stdout)).toMatchObject({ [bobsURL]: 'bob' });

    ({ stdout } = await rdctlCred('get', bobsURL));
    expect(JSON.parse(stdout)).toMatchObject(body);

    // Verify we can store and retrieve passwords with wacky characters in them.
    body.Secret = bobsSecondSecret;
    ({ stdout } = await rdctlCred('store', JSON.stringify(body)));
    expect(stdout).toBe('');

    ({ stdout } = await rdctlCred('get', bobsURL));
    expect(JSON.parse(stdout)).toMatchObject(body);

    ({ stdout } = await rdctlCred('erase', bobsURL));
    expect(stdout).toBe('');

    ({ stdout } = await rdctlCred('get', bobsURL));
    expect(stdout).toContain('credentials not found in native keychain');

    ({ stdout } = await rdctlCred('erase', bobsURL));
    expect(stdout).toContain('The specified item could not be found in the keychain');
  });

  test('should be able to use the script with stdin', async() => {
    const bobsURL = 'https://bobs.fish/tackle';
    const bobsFirstSecret = 'loblaw';
    const bobsSecondSecret = 'shoppers with spaces and % and \' and &s and even a 😱';

    const body = {
      ServerURL: bobsURL,
      Username:  'bob',
      Secret:    bobsFirstSecret
    };
    let { stdout } = await rdctlCredWithStdin('list');

    if (JSON.parse(stdout)[bobsURL]) {
      ({ stdout } = await rdctlCredWithStdin('erase', bobsURL));
      expect(stdout).toEqual('');
    }

    ({ stdout } = await rdctlCredWithStdin('store', JSON.stringify(body)));
    expect(stdout).toEqual('');

    ({ stdout } = await rdctlCredWithStdin('list'));
    expect(JSON.parse(stdout)).toMatchObject({ [bobsURL]: 'bob' });

    ({ stdout } = await rdctlCredWithStdin('get', bobsURL));
    expect(JSON.parse(stdout)).toMatchObject(body);

    // Verify we can store and retrieve passwords with wacky characters in them.
    body.Secret = bobsSecondSecret;
    ({ stdout } = await rdctlCredWithStdin('store', JSON.stringify(body)));
    expect(stdout).toBe('');

    ({ stdout } = await rdctlCredWithStdin('get', bobsURL));
    expect(JSON.parse(stdout)).toMatchObject(body);

    ({ stdout } = await rdctlCredWithStdin('erase', bobsURL));
    expect(stdout).toBe('');

    ({ stdout } = await rdctlCredWithStdin('get', bobsURL));
    expect(stdout).toContain('credentials not found in native keychain');

    ({ stdout } = await rdctlCredWithStdin('erase', bobsURL));
    expect(stdout).toContain('The specified item could not be found in the keychain');
  });
});
