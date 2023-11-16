/**
 * This tests WSL integrations; it is a Windows-only test.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import stream from 'stream';
import util from 'util';

import { expect, test as testBase } from '@playwright/test';
import tar from 'tar-stream';

import { NavPage } from './pages/nav-page';
import { PreferencesPage } from './pages/preferences';
import {
  createDefaultSettings, reportAsset, retry, startRancherDesktop, teardown,
} from './utils/TestUtils';

import { spawn, spawnFile } from '@pkg/utils/childProcess';
import { Log } from '@pkg/utils/logging';

import type { ElectronApplication, Page } from '@playwright/test';

type WSLFixtures = {
  wslError: string | undefined;
};

const console = new Log(path.basename(__filename, '.ts'), reportAsset(__filename, 'log'));

const test = testBase.extend<WSLFixtures>({
  // eslint-disable-next-line no-empty-pattern -- skip first arg
  wslError: async({}, use) => {
    if (process.platform !== 'win32') {
      await use('Only applies to Windows');

      return;
    }
    try {
      console.log('Checking WSL installation...');
      // WSL is expected to return with a non-zero exit code here.
      const buffers: Buffer[] = [];
      const proc = spawn('wsl.exe', ['--help'], { stdio: ['ignore', 'pipe', await console.fdStream], windowsHide: true });

      proc.stdout.on('data', (data) => {
        buffers.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
      });
      await new Promise<void>((resolve, reject) => {
        proc.on('exit', (code, signal) => {
          if (signal) {
            reject(`signal ${ signal }`);
          } else {
            resolve();
          }
        });
        proc.on('error', reject);
      });

      const textOut = Buffer.concat(buffers).toString('utf16le');

      if (textOut.includes('--exec')) {
        console.debug('WSL help output contains --exec');
        await use(undefined);
      } else {
        console.debug('WSL is not installed');
        await use('WSL is not installed');
      }
    } catch (ex) {
      console.log(`Failed to check WSL: ${ ex }`);
      await use(`Failed to check WSL: ${ ex }`);
    }
  },
});

test.describe('WSL Integrations', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(process.platform !== 'win32', 'Only applies on Windows');

  /** The directory containing our mock wsl.exe */
  let workdir = '';
  /** The environment variables, before our tests. */
  let electronApp: ElectronApplication;
  let page: Page;
  let preferencesWindow: PreferencesPage;
  /** The list of registered distros. */
  const distros: string[] = [];

  async function getPrefWindow(): Promise<PreferencesPage> {
    if (preferencesWindow && !preferencesWindow.page.isClosed()) {
      return preferencesWindow;
    }
    await new NavPage(page).preferencesButton.click();
    const prefPage = await electronApp.waitForEvent('window', page => /preferences/i.test(page.url()));

    // Wait for the window to actually load (i.e. transition from
    // app://index.html/#/preferences to app://index.html/#/Preferences#general)
    await prefPage.waitForURL(/Preferences#/i);
    preferencesWindow = new PreferencesPage(prefPage);

    return preferencesWindow;
  }

  test.beforeAll(({ wslError }) => {
    test.skip(!!wslError, wslError);
  });

  test.beforeAll(async() => {
    createDefaultSettings({
      WSL: {
        integrations: {
          '1-valid':    undefined,
          '2-valid':    undefined,
          '3-mount':    undefined,
          '4-no-mount': undefined,
          '5-wsl1':     undefined,
        },
      },
      kubernetes: { enabled: false },
    });

    electronApp = await startRancherDesktop(__filename);

    page = await electronApp.firstWindow();
  });
  test.afterAll(() => teardown(electronApp, __filename));

  test.beforeAll(async() => {
    workdir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'rd-test-wsl-integration-'));
  });

  test.afterAll(async() => {
    let lastError;

    for (const distro of distros) {
      try {
        await spawnFile('wsl.exe', ['--unregister', distro]);
        console.debug(`Distribution ${ distro } unregistered.`);
      } catch (ex) {
        console.error(`Failed to unregister distro ${ distro }:`, ex);
        lastError = ex;
      }
    }
    if (lastError) {
      throw lastError;
    }
  });
  test.afterAll(async() => {
    if (workdir) {
      await fs.promises.rm(workdir, {
        recursive:  true,
        maxRetries: 5,
      });
    }
  });

  function registerDistro(distro: string, files: Record<string, string> = {}, version = 2) {
    test.beforeAll(async() => {
      const dirs = new Set<string>();
      const pack = tar.pack();
      const distroPath = path.join(workdir, distro);
      const tarPath = path.join(workdir, `${ distro }.tar`);
      const outFile = pack.pipe(fs.createWriteStream(tarPath));
      const done = stream.promises.finished(outFile);
      const requiredFiles = {
        'etc/passwd': 'root:x:0:0:root:/:/',
        'etc/shadow': 'root:!:::::::',
        'etc/group':  'root:x:0:',
      };

      distros.push(distro);

      try {
        await spawnFile('wsl.exe', ['--unregister', distro], { stdio: 'ignore' });
      } catch {
        // This throws as expected if the distro doesn't exist; ignore.
      }
      // Ensure that there is a root user
      files = { ...requiredFiles, ...files };
      try {
        for (const filename of Object.keys(files)) {
          const parts = filename.split('/');

          for (let i = 0; i < parts.length - 1; ++i) {
            dirs.add(parts.slice(0, i + 1).join('/'));
          }
        }
        for (const name of Array.from(dirs).sort()) {
          pack.entry({ name, type: 'directory' });
        }
        for (const [name, value] of Object.entries(files)) {
          const input = stream.Readable.from(value);

          await stream.promises.finished(input.pipe(pack.entry({
            name, type: 'file', size: value.length,
          })));
        }

        pack.finalize();
        await done;

        await fs.promises.mkdir(path.join(workdir, distro), { recursive: true });
        console.debug(`Registering distribution ${ distro }...`);
        await spawnFile('wsl.exe', ['--import', distro, distroPath, tarPath, '--version', `${ version }`], { stdio: console });
        console.debug(`Distribution ${ distro } registered.`);
      } catch (ex) {
        console.error(ex, (ex as any).stack);
        throw ex;
      } finally {
        await fs.promises.unlink(tarPath);
      }
    });
  }
  registerDistro('1-valid');
  registerDistro('2-valid');
  registerDistro('3-mount', { 'etc/wsl.conf': '[automount]\nroot=/pikachu/' });
  registerDistro('4-no-mount', { 'etc/wsl.conf': '[automount]\nenabled=false' });
  registerDistro('5-wsl1', {}, 1);

  test('should open preferences modal', async() => {
    const prefWin = await getPrefWindow();

    expect(prefWin.wsl.tabIntegrations).toHaveCount(1);
  });

  test('should navigate to WSL and render integrations tab', async() => {
    const { wsl } = await getPrefWindow();

    await wsl.nav.click();

    await expect(wsl.nav).toHaveClass('preferences-nav-item active');
    await expect(wsl.tabIntegrations).toBeVisible();
  });

  // eslint-disable-next-line no-empty-pattern -- skip first arg
  test('should list integrations', async({}, { timeout }) => {
    const { wsl: wslPage } = await getPrefWindow();

    // Wait for all the distros to be registered first
    for (const distro of distros) {
      while (true) {
        const { stdout } = await spawnFile('wsl.exe', ['--list', '--quiet'], { encoding: 'utf16le', stdio: 'pipe' });

        if (stdout.split(/\r?\n/).includes(distro)) {
          break;
        }
        await util.promisify(setTimeout)(1_000);
      }
    }

    await wslPage.tabIntegrations.click();
    await expect(wslPage.wslIntegrations).toBeVisible();

    await expect(wslPage.wslIntegrations).toHaveCount(1, { timeout: 10_000 });

    // It takes longer than default to wait for the list to show up.
    await expect(wslPage.wslIntegrations.getByTestId('wsl-integration-list')).toBeVisible({ timeout: timeout * 10 });
    await expect(wslPage.getIntegration('1-valid')).toBeVisible();
    await expect(wslPage.getIntegration('2-valid')).toBeVisible();
    await expect(wslPage.getIntegration('3-mount')).toBeVisible();
    await expect(wslPage.getIntegration('4-no-mount')).toBeVisible();
    await expect(wslPage.getIntegration('5-wsl1')).toBeVisible();
  });

  test('should show checkbox states', async() => {
    const { wsl: wslPage } = await getPrefWindow();

    console.debug('should show checkbox states');
    const { stdout } = await spawnFile('wsl.exe', ['--list', '--verbose'], { encoding: 'utf16le', stdio: 'pipe' });

    console.debug(stdout);

    await expect(wslPage.getIntegration('1-valid')).toBeVisible();
    await expect(wslPage.getIntegration('1-valid').checkbox).not.toBeChecked();
    await expect(wslPage.getIntegration('1-valid').name).toHaveText('1-valid');
    await expect(wslPage.getIntegration('1-valid').container).not.toHaveClass(/(?<=\b)disabled\b/);
    await expect(wslPage.getIntegration('1-valid').error).not.toBeVisible();

    await expect(wslPage.getIntegration('2-valid')).toBeVisible();
    await expect(wslPage.getIntegration('2-valid').checkbox).not.toBeChecked();
    await expect(wslPage.getIntegration('2-valid').name).toHaveText('2-valid');
    await expect(wslPage.getIntegration('2-valid').container).not.toHaveClass(/(?<=\b)disabled\b/);
    await expect(wslPage.getIntegration('2-valid').error).not.toBeVisible();

    await expect(wslPage.getIntegration('3-mount')).toBeVisible();
    await expect(wslPage.getIntegration('3-mount').checkbox).not.toBeChecked();
    await expect(wslPage.getIntegration('3-mount').name).toHaveText('3-mount');
    await expect(wslPage.getIntegration('3-mount').container).not.toHaveClass(/(?<=\b)disabled\b/);
    await expect(wslPage.getIntegration('3-mount').error).not.toBeVisible();

    await expect(wslPage.getIntegration('4-no-mount')).toBeVisible();
    await expect(wslPage.getIntegration('4-no-mount').checkbox).not.toBeChecked();
    await expect(wslPage.getIntegration('4-no-mount').name).toHaveText('4-no-mount');
    await expect(wslPage.getIntegration('4-no-mount').container).toHaveClass(/(?<=\b)disabled\b/);
    await expect(wslPage.getIntegration('4-no-mount').error).toBeVisible();
    await expect(wslPage.getIntegration('4-no-mount').error).toContainText(/error/i);

    await expect(wslPage.getIntegration('5-wsl1')).toBeVisible();
    await expect(wslPage.getIntegration('5-wsl1').checkbox).not.toBeChecked();
    await expect(wslPage.getIntegration('5-wsl1').name).toHaveText('5-wsl1');
    await expect(wslPage.getIntegration('5-wsl1').container).toHaveClass(/(?<=\b)disabled\b/);
    await expect(wslPage.getIntegration('5-wsl1').error).toBeVisible();
    await expect(wslPage.getIntegration('5-wsl1').error).toContainText(/v1/i);
  });

  test('enabled and disabling integration', async() => {
    const markerPath = `\\\\wsl$\\1-valid\\.rancher-desktop-integration`;

    async function distro() {
      return (await getPrefWindow()).wsl.getIntegration('1-valid');
    }

    await test.step('should allow enabling integration', async() => {
      console.debug(`Enabling WSL integration for 1-valid...`);
      await expect((await distro()).checkbox).not.toBeChecked();
      await expect((await distro()).checkbox).toBeEnabled();
      await (await distro()).container.click();
      await expect((await distro()).checkbox).toBeChecked();

      await expect((await getPrefWindow()).wsl.getIntegration('2-valid').checkbox).not.toBeChecked();
      await (await getPrefWindow()).apply();
    });
    await test.step('should have integration marker', async() => {
      console.debug(`Checking WSL integration marker for 1-valid...`);
      const result = retry(() => fs.promises.stat(markerPath), { delay: 1_000, tries: 30 });

      await expect(result).resolves.toBeTruthy();
    });
    await test.step('should allow disabling integration', async() => {
      console.debug(`Disabling WSL integration for 1-valid...`);
      await expect((await distro()).checkbox).toBeChecked();
      await (await distro()).container.click();
      await expect((await distro()).checkbox).not.toBeChecked();
      await (await getPrefWindow()).apply();
    });
    await test.step('should not have integration marker', async() => {
      console.debug(`Checking WSL integration marker missing for 1-valid...`);
      const result = retry(async() => {
        let result;

        try {
          result = await fs.promises.stat(markerPath);
        } catch (ex) {
          console.debug(`Caught: ${ ex }`);

          return;
        }
        console.debug(`Not caught: ${ JSON.stringify(result) }`);
        throw new Error('marker exists');
      }, { delay: 1_000, tries: 30 });

      await expect(result).resolves.toBeUndefined();
      console.debug(`WSL integration marker is missing as expected`);
    });
  });
});
