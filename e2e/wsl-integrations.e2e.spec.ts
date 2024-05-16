/**
 * This tests WSL integrations; it is a Windows-only test.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import { expect, test } from '@playwright/test';

import { NavPage } from './pages/nav-page';
import { PreferencesPage } from './pages/preferences';
import { createDefaultSettings, retry, startRancherDesktop, teardown } from './utils/TestUtils';

import { spawnFile } from '@pkg/utils/childProcess';

import type { ElectronApplication, Page } from '@playwright/test';

test.describe('WSL Integrations', () => {
  test.describe.configure({ mode: 'serial' });
  if (os.platform() !== 'win32') {
    test.skip();
  }

  /** The directory containing our mock wsl.exe */
  let workdir = '';
  /** The environment variables, before our tests. */
  let electronApp: ElectronApplication;
  let page: Page;
  let preferencesWindow: Page;

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

  const writeConfig = async(opts?: {[k in 'alpha'|'beta'|'gamma']?: boolean|string}) => {
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
          ...[['bin', 'docker-compose'], ['internal', 'wsl-helper']].flatMap(tool => ([
            {
              args:   ['--distribution', distro, '--exec', '/bin/wslpath', '-a', '-u', path.join(process.cwd(), 'resources', 'linux', ...tool)],
              mode:   'repeated',
              stdout: `/${ distro }/${ tool.join('/') }`,
            }])),
          ...[['bin', 'docker-buildx'], ['internal', 'wsl-helper']].flatMap(tool => ([
            {
              args:   ['--distribution', distro, '--exec', '/bin/wslpath', '-a', '-u', path.join(process.cwd(), 'resources', 'linux', ...tool)],
              mode:   'repeated',
              stdout: `/${ distro }/${ tool.join('/') }`,
            }])),
          ...[
            [`/${ distro }/internal/wsl-helper`, 'kubeconfig', '--enable=false'],
            [`/${ distro }/internal/wsl-helper`, 'kubeconfig', '--enable=true'],
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
            args:   ['--distribution', distro, '--exec', '/bin/sh', '-c', 'readlink -f "$HOME/.docker/cli-plugins/docker-buildx"'],
            mode:   'repeated',
            stdout: '/dev/null',
          },
          {
            args:   ['--distribution', distro, '--exec', '/bin/sh', '-c', 'readlink -f "$HOME/.docker/cli-plugins/docker-compose"'],
            mode:   'repeated',
            stdout: '/dev/null',
          },
          {
            args:   ['--distribution', distro, '--user', 'root', '--exec', `/${ distro }/internal/wsl-helper`, 'docker-proxy', 'serve', '--verbose'],
            mode:   'repeated',
            stdout: '/dev/null',
          },
          {
            args:   ['--distribution', distro, '--user', 'root', '--exec', `/${ distro }/internal/wsl-helper`, 'docker-proxy', 'kill', '--verbose'],
            mode:   'repeated',
            stdout: '/dev/null',
          },
        ]),
        {
          args:   ['--distribution', 'alpha', '--exec', '/alpha/internal/wsl-helper', 'kubeconfig', '--show'],
          mode:   'repeated',
          stdout: (opts?.alpha ?? false).toString(),
        },
        {
          args:   ['--distribution', 'beta', '--exec', '/beta/internal/wsl-helper', 'kubeconfig', '--show'],
          mode:   'repeated',
          stdout: (opts?.beta ?? true).toString(),
        },
        {
          args:   ['--distribution', 'gamma', '--exec', '/gamma/internal/wsl-helper', 'kubeconfig', '--show'],
          mode:   'repeated',
          stdout: (opts?.gamma ?? 'some error').toString(),
        },
        {
          args: ['--distribution', 'rancher-desktop', '--exec', '/usr/local/bin/nerdctl', '--address',
            '/run/k3s/containerd/containerd.sock', 'namespace', 'list', '--quiet'],
          mode:   'repeated',
          stdout: 'default',
        },
      ],
    };

    // Sometimes trying to update this file triggers an EBUSY error, so retry it.
    await retry(() => {
      return fs.promises.writeFile(path.join(workdir, 'config.json'), JSON.stringify(config, undefined, 2));
    }, { delay: 500, tries: 20 });
  };

  // We need the beforeAll to allow initial Electron startup.
  test.beforeAll(async() => await writeConfig());
  test.beforeEach(async() => await writeConfig());
  test.afterAll(async() => {
    if (workdir) {
      await fs.promises.rm(workdir, {
        recursive:  true,
        maxRetries: 5,
      });
    }
  });

  test.beforeAll(async({ colorScheme }, testInfo) => {
    createDefaultSettings();

    electronApp = await startRancherDesktop(testInfo, {
      env: {
        PATH:             path.join(workdir, 'system32') + path.delimiter + process.env.PATH,
        RD_TEST_WSL_EXE:  path.join(workdir, 'system32', 'wsl.exe'),
        RD_MOCK_WSL_DATA: path.join(workdir, 'config.json'),
      },
    });

    page = await electronApp.firstWindow();
    await new NavPage(page).preferencesButton.click();
    preferencesWindow = await electronApp.waitForEvent('window', page => /preferences/i.test(page.url()));
  });
  test.afterAll(({ colorScheme }, testInfo) => teardown(electronApp, testInfo));

  test('should open preferences modal', async() => {
    expect(preferencesWindow).toBeDefined();

    // Wait for the window to actually load (i.e. transition from
    // app://index.html/#/preferences to app://index.html/#/Preferences#general)
    await preferencesWindow.waitForURL(/Preferences#/i);
  });

  test('should navigate to WSL and render integrations tab', async() => {
    const { wsl } = new PreferencesPage(preferencesWindow);

    await wsl.nav.click();

    await expect(wsl.nav).toHaveClass('preferences-nav-item active');
    await expect(wsl.tabIntegrations).toBeVisible();
  });

  test('should list integrations', async() => {
    const { wsl: wslPage } = new PreferencesPage(preferencesWindow);

    await wslPage.tabIntegrations.click();
    await expect(wslPage.wslIntegrations).toBeVisible();

    await expect(wslPage.wslIntegrations).toHaveCount(1, { timeout: 10_000 });
    const wslIntegrationList = wslPage.tabIntegrations.getByTestId('wsl-integration-list');

    expect(wslIntegrationList.getByText('alpha')).not.toBeNull();
    expect(wslIntegrationList.getByText('beta')).not.toBeNull();
    expect(wslIntegrationList.getByText('gamma')).not.toBeNull();
  });

  /*
  test('should show checkbox states', (async() => {
    const integrations = wslPage.wslIntegrations;
    const alpha = integrations.find(item => item.name === 'alpha');
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
    const { wsl: wslPage } = new PreferencesPage(preferencesWindow);
    await wslPage.reload();
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
    await wslPage.reload();
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
    await wslPage.reload();
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
 */
});
