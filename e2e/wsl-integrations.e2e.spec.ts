/**
 * This tests WSL integrations; it is a Windows-only test.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import { expect, test, _electron } from '@playwright/test';

import { NavPage } from './pages/nav-page';
import { createDefaultSettings, startRancherDesktop, teardown } from './utils/TestUtils';

import { spawnFile } from '@pkg/utils/childProcess';

import type { ElectronApplication, Page } from '@playwright/test';

test.describe('WSL Integrations', () => {
  test.skip(true, 'TODO: https://github.com/rancher-sandbox/rancher-desktop/issues/2881');
  test.describe.configure({ mode: 'serial' });
  if (os.platform() !== 'win32') {
    test.skip();
  }

  /** The directory containing our mock wsl.exe */
  let workdir = '';
  /** The environment variables, before our tests. */
  let electronApp: ElectronApplication;
  let page: Page;

  test.beforeAll(async() => {
    const stubDir = path.resolve(__dirname, '..', 'src', 'go', 'mock-wsl');

    workdir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'rd-test-wsl-integration-'));
    await fs.promises.mkdir(path.join(workdir, 'system32'));
    await spawnFile('go',
      ['build', '-o', path.join(workdir, 'system32', 'wsl.exe'), '.'], {
        stdio: 'inherit',
        cwd:   stubDir,
        env:   {
          ...process.env,
          CGO_ENABLED: '1',
        },
      });
  });

  const writeConfig = async(opts?:{[k in 'alpha'|'beta'|'gamma']?: boolean|string}) => {
    const config: {
      commands: {
        args: string[],
        mode?: string,
        stdout?: string,
        stderr?: string,
        utf16le?: boolean,
      }[]
    } = {
      commands: [
        {
          args:    ['--list', '--quiet'],
          mode:    'repeated',
          stdout:  ['alpha', 'beta', 'gamma'].join('\n'),
          utf16le: true,
        },
        {
          args:   ['--list', '--verbose'],
          mode:   'repeated',
          stdout: [
            '  NAME   STATE    VERSION',
            '  alpha  Stopped  2',
            '  beta   Stopped  2',
            '  gamma  Stopped  2',
            '',
          ].join('\n'),
          utf16le: true,
        },
        ...['alpha', 'beta', 'gamma'].flatMap(distro => [
          ...[['bin', 'docker-compose'], ['wsl-helper']].flatMap(tool => ([
            {
              args:   ['--distribution', distro, '--exec', '/bin/wslpath', '-a', '-u', path.join(process.cwd(), 'resources', 'linux', ...tool)],
              mode:   'repeated',
              stdout: `/${ distro }/${ tool.join('/') }`,
            }])),
          ...[
            [`/${ distro }/wsl-helper`, 'kubeconfig', '--enable=false'],
            [`/${ distro }/wsl-helper`, 'kubeconfig', '--enable=true'],
            ['/bin/sh', '-c', 'mkdir -p "$HOME/.docker/cli-plugins"'],
            ['/bin/sh', '-c',
              `if [ ! -e "$HOME/.docker/cli-plugins/docker-compose" -a ! -L "$HOME/.docker/cli-plugins/docker-compose" ] ; then
                ln -s "/${ distro }/bin/docker-compose" "$HOME/.docker/cli-plugins/docker-compose" ;
              fi`.replace(/\s+/g, ' ')],
            ['/bin/sh', '-c', 'mkdir -p "$HOME/.docker/cli-plugins"'],
          ].map(cmd => ({
            args: ['--distribution', distro, '--exec', ...cmd],
            mode: 'repeated',
          })),
          {
            args:   ['--distribution', distro, '--exec', '/bin/sh', '-c', 'readlink -f "$HOME/.docker/cli-plugins/docker-compose"'],
            mode:   'repeated',
            stdout: '/dev/null',
          },
          {
            args:   ['--distribution', distro, '--user', 'root', '--exec', `/${ distro }/wsl-helper`, 'docker-proxy', 'serve', '--verbose'],
            mode:   'repeated',
            stdout: '/dev/null',
          },
          {
            args:   ['--distribution', distro, '--user', 'root', '--exec', `/${ distro }/wsl-helper`, 'docker-proxy', 'kill', '--verbose'],
            mode:   'repeated',
            stdout: '/dev/null',
          },
        ]),
        {
          args:   ['--distribution', 'alpha', '--exec', '/alpha/wsl-helper', 'kubeconfig', '--show'],
          mode:   'repeated',
          stdout: (opts?.alpha ?? false).toString(),
        },
        {
          args:   ['--distribution', 'beta', '--exec', '/beta/wsl-helper', 'kubeconfig', '--show'],
          mode:   'repeated',
          stdout: (opts?.beta ?? true).toString(),
        },
        {
          args:   ['--distribution', 'gamma', '--exec', '/gamma/wsl-helper', 'kubeconfig', '--show'],
          mode:   'repeated',
          stdout: (opts?.gamma ?? 'some error').toString(),
        },
      ],
    };

    await fs.promises.writeFile(path.join(workdir, 'config.json'), JSON.stringify(config, undefined, 2));
  };

  // We need the beforeAll to allow initial Electron startup.
  test.beforeAll(() => writeConfig());
  test.beforeEach(() => writeConfig());
  test.afterEach(async() => {
    const config = JSON.parse(await fs.promises.readFile(path.join(workdir, 'config.json'), 'utf-8'));

    expect(config.errors ?? []).toEqual([]);
  });
  test.afterAll(async() => {
    if (workdir) {
      await fs.promises.rm(workdir, { recursive: true, maxRetries: 5 });
    }
  });

  test.beforeAll(async() => {
    createDefaultSettings();

    electronApp = await startRancherDesktop(__filename, {
      env: {
        PATH:             path.join(workdir, 'system32') + path.delimiter + process.env.PATH,
        RD_TEST_WSL_EXE:  path.join(workdir, 'system32', 'wsl.exe'),
        RD_MOCK_WSL_DATA: path.join(workdir, 'config.json'),
      },
    });

    page = await electronApp.firstWindow();
  });
  test.afterAll(() => teardown(electronApp, __filename));

  test('should list integrations', async() => {
    await page.reload();

    const navPage = new NavPage(page);
    const wslPage = await navPage.navigateTo('WSLIntegrations');

    await expect(wslPage.integrations).toHaveCount(1, { timeout: 10_000 });

    const alpha = wslPage.getIntegration('alpha');
    const beta = wslPage.getIntegration('beta');
    const gamma = wslPage.getIntegration('gamma');

    await expect(alpha.locator).toHaveCount(1);
    await expect(alpha.checkbox).not.toBeChecked();
    await expect(alpha.name).toHaveText('alpha');
    await expect(alpha.error).not.toBeVisible();

    await expect(beta.locator).toHaveCount(1);
    await expect(beta.checkbox).toBeChecked();
    await expect(beta.name).toHaveText('beta');
    await expect(beta.error).not.toBeVisible();

    await expect(gamma.locator).toHaveCount(1);
    await expect(gamma.checkbox).not.toBeChecked();
    await expect(gamma.name).toHaveText('gamma');
    await expect(gamma.error).toHaveText('some error');
  });

  test('should allow enabling integration', async() => {
    await page.reload();

    const navPage = new NavPage(page);
    const wslPage = await navPage.navigateTo('WSLIntegrations');
    const integrations = wslPage.integrations;

    await expect(integrations).toHaveCount(1, { timeout: 10_000 });

    const alpha = wslPage.getIntegration('alpha');

    await expect(alpha.checkbox).not.toBeChecked();
    await alpha.assertEnabled();
    await alpha.click();
    await alpha.assertDisabled();
    await writeConfig({ alpha: true });
    await alpha.assertEnabled();
    await expect(alpha.checkbox).toBeChecked();
  });

  test('should allow disabling integration', async() => {
    await page.reload();

    const navPage = new NavPage(page);
    const wslPage = await navPage.navigateTo('WSLIntegrations');
    const integrations = wslPage.integrations;

    await expect(integrations).toHaveCount(1, { timeout: 10_000 });

    const beta = wslPage.getIntegration('beta');

    await expect(beta.checkbox).toBeChecked();
    await beta.assertEnabled();
    await beta.click();
    await beta.assertDisabled();
    await writeConfig({ beta: false });
    await beta.assertEnabled();
    await expect(beta.checkbox).not.toBeChecked();
  });

  test('should update invalid reason', async() => {
    await page.reload();

    const navPage = new NavPage(page);
    const wslPage = await navPage.navigateTo('WSLIntegrations');
    const integrations = wslPage.integrations;

    await expect(integrations).toHaveCount(1, { timeout: 10_000 });

    const gamma = wslPage.getIntegration('gamma');

    await gamma.assertDisabled();
    await expect(gamma.error).toHaveText('some error');
    await writeConfig({ gamma: 'some other error' });

    await page.reload();
    const newGamma = (await navPage.navigateTo('WSLIntegrations')).getIntegration('gamma');

    await expect(newGamma.error).toHaveText('some other error');
    await newGamma.assertDisabled();
  });
});
