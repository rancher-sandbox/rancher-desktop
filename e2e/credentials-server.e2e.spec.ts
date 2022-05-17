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
import { spawnSync } from 'child_process';

import { expect, test } from '@playwright/test';
import { BrowserContext, ElectronApplication, Page, _electron } from 'playwright';

import fetch from 'node-fetch';
import { createDefaultSettings, playwrightReportAssets } from './utils/TestUtils';
import paths from '@/utils/paths';
import { ServerState } from '@/main/commandServer/httpCommandServer';
import { getWSLAddr } from '@/main/credentialServer/httpCredentialHelperServer';
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
  // Assign these values on first request once we have an authString
  // And we can't assign to ipaddr on Windows here because we need an async context.
  let command = '';
  let ipaddr: string|undefined = '';
  let initialArgs: string[] = [];

  async function doRequest(path: string, body = '') {
    if (!ipaddr) {
      if (os.platform() === 'win32') {
        command = 'wsl';
        ipaddr = await getWSLAddr();
        if (!ipaddr) {
          throw new Error('Failed to get the WSL IP address');
        }
        initialArgs = ['--distribution', 'rancher-desktop', '--exec', 'curl'];
      } else {
        command = 'curl';
        ipaddr = 'localhost';
      }
      initialArgs = initialArgs.concat(['--silent', '--user', authString, '--request', 'POST']);
    }
    const args = initialArgs.concat([`http://${ ipaddr }:${ serverState.port }/${ path }`]);

    if (body.length) {
      args.push('--data', body);
    }
    const { stdout, stderr } = await spawnFile(command, args, { stdio: 'pipe' });

    expect(stderr).toEqual('');

    return stdout;
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
    authString = `${ serverState.user }:${ serverState.password }`;
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
});
