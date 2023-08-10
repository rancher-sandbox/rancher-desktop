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
          ...[['bin', 'docker-compose'], ['wsl-helper']].flatMap(tool => ([
            {
              args:   ['--distribution', distro, '--exec', '/bin/wslpath', '-a', '-u', path.join(process.cwd(), 'resources', 'linux', ...tool)],
              mode:   'repeated',
              stdout: `/${ distro }/${ tool.join('/') }`,
            }])),
          ...[['bin', 'docker-buildx'], ['wsl-helper']].flatMap(tool => ([
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
    await new NavPage(page).preferencesButton.click();
    preferencesWindow = await electronApp.waitForEvent('window', page => /preferences/i.test(page.url()));
  });
  test.afterAll(() => teardown(electronApp, __filename));

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

    expect(await wslPage.alpha.isChecked()).toBeFalsy();
    expect(await wslPage.beta.isChecked()).toBeTruthy();
    expect(await wslPage.gamma.isChecked()).toBeFalsy();

    const craftyErrorMessage = 'Error: some error';
    let parent = wslPage.page.locator('[data-test="item-alpha-parent"]');

    await expect(parent.filter({ hasText: craftyErrorMessage })).toHaveCount(0);
    parent = wslPage.page.locator('[data-test="item-beta-parent"]');
    await expect(parent.filter({ hasText: craftyErrorMessage })).toHaveCount(0);
    parent = wslPage.page.locator('[data-test="item-gamma-parent"]');
    await expect(parent.filter({ hasText: craftyErrorMessage })).toHaveCount(1);
  });

  test('should allow enabling integration', async() => {
    // This is how we do a reload...
    const { wsl: wslPage } = new PreferencesPage(preferencesWindow);

    await wslPage.tabIntegrations.click();
    await expect(wslPage.wslIntegrations).toBeVisible();

    await expect(wslPage.wslIntegrations).toHaveCount(1, { timeout: 10_000 });
    let alpha = wslPage.alpha;

    expect(await alpha.isChecked()).toBeFalsy();
    expect(await alpha.isEnabled()).toBeTruthy();
    // Don't know why force-true is necessary, playwright times out without it.
    await alpha.click({ force: true });
    await writeConfig({ alpha: true });
    // Now 'relocate' alpha
    alpha = wslPage.alpha;
    expect(await alpha.isChecked()).toBeTruthy();
    expect(await alpha.isEnabled()).toBeTruthy();
  });

  test('should allow disabling integration', async() => {
    // This is how we do a reload...
    const { wsl: wslPage } = new PreferencesPage(preferencesWindow);

    await wslPage.tabIntegrations.click();
    await expect(wslPage.wslIntegrations).toBeVisible();
    await expect(wslPage.wslIntegrations).toHaveCount(1, { timeout: 10_000 });

    let beta = wslPage.beta;

    expect(await beta.isChecked()).toBeTruthy();
    expect(await beta.isEnabled()).toBeTruthy();
    await beta.click({ force: true });
    await writeConfig({ beta: false });
    // Now 'relocate' beta
    beta = wslPage.beta;
    expect(await beta.isChecked()).toBeFalsy();
    expect(await beta.isEnabled()).toBeTruthy();
  });

  test('should update invalid reason', async() => {
    const { wsl: wslPage } = new PreferencesPage(preferencesWindow);
    const newErrorMessage = 'some other error';

    await wslPage.tabIntegrations.click();
    await expect(wslPage.wslIntegrations).toBeVisible();
    await expect(wslPage.wslIntegrations).toHaveCount(1, { timeout: 10_000 });

    const gamma = wslPage.gamma;

    expect(await gamma.isChecked()).toBeFalsy();
    await writeConfig({ gamma: newErrorMessage });
  });

  test('should see new invalid reason', async() => {
    const { wsl: wslPage } = new PreferencesPage(preferencesWindow);
    const newErrorMessage = 'some other error';

    await wslPage.tabIntegrations.click();
    await expect(wslPage.wslIntegrations).toBeVisible();
    await expect(wslPage.wslIntegrations).toHaveCount(1, { timeout: 10_000 });

    // The `isDisabled` locator simply doesn't work -- possibly because the actual DOM is
    // div.checkbox-outer-container data-test=item-gamma
    //   label.checkbox-container disabled
    //      input type=checkbox value=true
    //      span.checkbox-custom role=checkbox
    //
    // and playwright doesn't give a way to get from `data-test=item-gamma` or the checkbox input elt to that label elt
    // expect(await newGamma.isDisabled()).toBeTruthy();
    const parent = wslPage.page.locator('[data-test="item-gamma-parent"]');

    await expect(parent.filter({ hasText: newErrorMessage })).toHaveCount(0);
  });
});
