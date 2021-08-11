/**
 * This file contains tests that require Kubernetes to be running.
 */

import os from 'os';
import path from 'path';
import util from 'util';

import fetch from 'node-fetch';
import { Application } from 'spectron';

import * as childProcess from '../src/utils/childProcess';

const electronPath = require('electron');

jest.setTimeout(600_000);

async function tool(tool: string, ...args: string[]): Promise<string> {
  const srcDir = path.dirname(__dirname);
  const filename = os.platform().startsWith('win') ? `${ tool }.exe` : tool;
  const exe = path.join(srcDir, 'resources', os.platform(), 'bin', filename);

  try {
    const { stdout } = await childProcess.spawnFile(
      exe, args, { stdio: ['ignore', 'pipe', 'inherit'] });

    return stdout;
  } catch (ex) {
    console.error(`Error running ${ tool } ${ args.join(' ') }`);
    console.error(`stdout: ${ ex.stdout }`);
    console.error(`stderr: ${ ex.stderr }`);
    throw ex;
  }
}

async function kubectl(...args: string[] ): Promise<string> {
  return await tool('kubectl', ...args);
}

async function helm(...args: string[]): Promise<string> {
  return await tool('helm', ...args);
}

describe('Rancher Desktop', () => {
  let app: Application;

  beforeAll(async() => {
    app = new Application({
      // 'any' typing is required for now as other alternate usage/import
      //  cause issues running the tests. Without 'any' typescript
      //  complains of type mismatch.
      path: electronPath as unknown as string,
      args: [path.dirname(__dirname)],
    });

    await app.start();
    await app.client.waitUntilWindowLoaded();
    const progress = await app.client.$('.progress');

    // Wait for the progress bar to exist
    await progress.waitForExist();
    // Wait for it to disappear again
    await progress.waitForExist({ timeout: 600_000, reverse: true });
  });

  afterAll(async() => {
    if (!app?.isRunning()) {
      console.error('afterAll: app is not running');

      return;
    }

    // Due to graceful Kubernetes shutdown, we need to try to quit harder.
    // The actual object here doesn't match the TypeScript definitions.
    const remoteApp = (app.electron as any).remote.app;

    await remoteApp.quit() as Promise<void>;
    await app.stop();
  });

  it('should run Kubernetes', async() => {
    const output = await kubectl('cluster-info');
    // Filter out ANSI escape codes (colours).
    const filteredOutput = output.replaceAll(/\033\[.*?m/g, '');

    expect(filteredOutput).toContain('Kubernetes control plane is running at https://127.0.0.1:6443');
  });

  it('shoud deploy Wordpress', async() => {
    // Check that the node is ready; this should already be the case.
    let nodeName = '';

    for (let i = 0; i < 10; i++) {
      nodeName = (await kubectl('get', 'nodes', '--output=name')).trim();
      if (nodeName) {
        break;
      }
      await util.promisify(setTimeout)(5_000);
    }
    expect(nodeName).not.toBeFalsy();
    await kubectl('wait', '--for=condition=Ready', nodeName);

    await helm('repo', 'add', 'bitnami', 'https://charts.bitnami.com/bitnami');
    try {
      const portExpr = '{.spec.ports[?(@.name=="http")].nodePort}';

      await helm('install',
        '--wait', '--timeout=10m',
        'wordpress', 'bitnami/wordpress',
        '--set=service.type=NodePort',
        '--set=volumePermissions.enabled=true',
        '--set=mariadb.volumePermissions.enabled=true');
      const port = await kubectl('get', 'service/wordpress', `--output=jsonpath=${ portExpr }`);
      const url = `http://localhost:${ port.trim() }/category/uncategorized/`;
      const response = await fetch(url);

      console.log(`Checking response from ${ url }...`);
      expect(response.ok).toBeTruthy();
    } finally {
      await helm('delete', 'wordpress');
    }
  });
});
