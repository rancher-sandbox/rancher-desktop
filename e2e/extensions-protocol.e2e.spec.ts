/*
 * This tests the extension protocol handler.
 * An E2E test is required to have access to the web page context.
 */

import path from 'path';

import { ElectronApplication, Page, test, expect } from '@playwright/test';

import { NavPage } from './pages/nav-page';
import { createDefaultSettings, retry, startRancherDesktop, teardown } from './utils/TestUtils';

import { ContainerEngine, Settings } from '@pkg/config/settings';
import { spawnFile } from '@pkg/utils/childProcess';

/** The top level source directory, assuming we're always from the tree */
const srcDir = path.dirname(path.dirname(__filename));
const rdctl = executable('rdctl');

/**
 * Get the given executable. Similar to @pkg/utils/resources, but does not use
 * Electron.app (which doesn't work during the test).
 */
function executable(name: string) {
  const exeName = name + (process.platform === 'win32' ? '.exe' : '');

  return path.join(srcDir, 'resources', process.platform, 'bin', exeName);
}

test.describe.serial('Extensions protocol handler', () => {
  let app: ElectronApplication;
  let page: Page;
  let isContainerd = false;

  async function ctrctl(...args: string[]) {
    let tool = executable('nerdctl');

    if (!isContainerd) {
      tool = executable('docker');
      args = ['--context', 'rancher-desktop'].concat(args);
    }

    return await spawnFile(tool, args, { stdio: 'pipe' });
  }

  test.beforeAll(async() => {
    createDefaultSettings();
    app = await startRancherDesktop(__filename, { mock: false });
    page = await app.firstWindow();
  });

  test.afterAll(() => teardown(app, __filename));

  test('should load backend', async() => {
    await (new NavPage(page)).progressBecomesReady();
  });

  test('determine container engine in use', async() => {
    const { stdout } = await spawnFile(rdctl, ['list-settings'], { stdio: 'pipe' });
    const settings: Settings = JSON.parse(stdout);

    expect(settings.containerEngine.name).toMatch(/^(?:containerd|moby)$/);
    isContainerd = settings.containerEngine.name === ContainerEngine.CONTAINERD;
  });

  test('wait for buildkit', async() => {
    test.skip(!isContainerd, 'Not running containerd, no need to wait for buildkit');

    await retry(() => spawnFile(rdctl, ['shell', 'buildctl', 'debug', 'info']));
  });

  test('build and install testing extension', async() => {
    const dataDir = path.join(srcDir, 'bats', 'tests', 'extensions', 'testdata');

    await ctrctl('build', '--tag', 'rd/extension/ui', '--build-arg', 'variant=ui', dataDir);
    await spawnFile(rdctl, ['api', '-XPOST', '/v1/extensions/install?id=rd/extension/ui']);
  });

  test('use extension protocol handler', async() => {
    const result = await page.evaluate(async() => {
      const data = await fetch('x-rd-extension://72642f657874656e73696f6e2f7569/dashboard-tab/ui/index.html');

      return await data.text();
    });

    expect(result).toContain('ddClient');
  });
});
