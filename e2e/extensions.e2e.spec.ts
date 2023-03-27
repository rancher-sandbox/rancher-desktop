/*
 * This tests interactions with the extension front end.
 * An E2E test is required to have access to the web page context.
 */

import os from 'os';
import path from 'path';

import {
  ElectronApplication, Page, test, expect, JSHandle,
} from '@playwright/test';

import { NavPage } from './pages/nav-page';
import {
  createDefaultSettings, getResourceBinDir, retry, startRancherDesktop, teardown,
} from './utils/TestUtils';

import { ContainerEngine, Settings } from '@pkg/config/settings';
import { spawnFile } from '@pkg/utils/childProcess';

import type { BrowserView, BrowserWindow } from 'electron';

/** The top level source directory, assuming we're always running from the tree */
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

test.describe.serial('Extensions', () => {
  let app: ElectronApplication;
  let page: Page;
  let isContainerd = false;

  async function ctrctl(...args: string[]) {
    let tool = executable('nerdctl');

    if (isContainerd) {
      args = ['--namespace', 'rancher-desktop-extensions'].concat(args);
    } else {
      tool = executable('docker');
      if (process.platform !== 'win32') {
        args = ['--context', 'rancher-desktop'].concat(args);
      }
    }

    return await spawnFile(tool, args,
      {
        stdio: 'pipe',
        env:   {
          ...process.env,
          PATH: `${ process.env.PATH }${ path.delimiter }${ getResourceBinDir() }`,
        },
      });
  }

  test.beforeAll(async() => {
    createDefaultSettings({ kubernetes: { enabled: false } });
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

    // `buildctl debug info` talks to the backend (to fetch info about it), so
    // if it succeeds it means the backend is up and can respond to requests.
    await retry(() => spawnFile(rdctl, ['shell', 'buildctl', 'debug', 'info']));
  });

  test('wait for docker context', async() => {
    test.skip(isContainerd, 'Not running moby, no need to wait for context');
    test.skip(process.platform === 'win32', 'Not setting context on Windows');

    await retry(() => ctrctl('context', 'inspect', 'rancher-desktop'));
  });

  test('wait for docker daemon to be up', async() => {
    test.skip(isContainerd, 'Not running moby, no need to wait for context');

    // On Windows, the docker proxy can flap for a while. So we try a few times
    // in a row (with pauses in the middle) to ensure the backend is stable
    // before continuing.
    for (let i = 0; i < 10; ++i) {
      await retry(() => ctrctl('system', 'info'));
      await new Promise(resolve => setTimeout(resolve, 1_000));
    }
  });

  test('build and install testing extension', async() => {
    const dataDir = path.join(srcDir, 'bats', 'tests', 'extensions', 'testdata');

    await ctrctl('build', '--tag', 'rd/extension/ui', '--build-arg', 'variant=ui', dataDir);
    await spawnFile(rdctl, ['api', '-XPOST', '/v1/extensions/install?id=rd/extension/ui']);
  });

  test('use extension protocol handler', async() => {
    const result = await page.evaluate(async() => {
      const data = await fetch('x-rd-extension://72642f657874656e73696f6e2f7569/ui/dashboard-tab/ui/index.html');

      return await data.text();
    });

    expect(result).toContain('ddClient');
  });

  test.describe('extension API', () => {
    let view: JSHandle<BrowserView>;

    test('extension UI can be loaded', async() => {
      const window = await app.browserWindow(page);

      await page.click('.nav .nav-item[data-id="extension:rd/extension/ui"]');

      // Try until we can get a BrowserView for the extension (because it can
      // take some time to load).
      view = await retry(async() => {
        // Evaluate script remotely to look for the appropriate BrowserView
        const result = await window.evaluateHandle((window: BrowserWindow) => {
          for (const view of window.getBrowserViews()) {
            if (view.webContents.mainFrame.url.startsWith('x-rd-extension://')) {
              return view;
            }
          }
        }) as JSHandle<BrowserView|undefined>;

        // Check that the result evaluated to the view, and not undefined.
        if (await (result).evaluate(v => typeof v) === 'undefined') {
          throw new Error('Could not find extension view');
        }

        return result as JSHandle<BrowserView>;
      });
    });

    /** evaluate a short snippet in the extension context. */
    function evalInView(script: string): Promise<any> {
      return view.evaluate((v, { script }) => {
        return v.webContents.executeJavaScript(script);
      }, { script });
    }

    test('exposes API endpoint', async() => {
      const result = {
        platform: await evalInView('ddClient.host.platform'),
        arch:     await evalInView('ddClient.host.arch'),
        hostname: await evalInView('ddClient.host.hostname'),
      };

      expect(result).toEqual({
        platform: os.platform(),
        arch:     os.arch(),
        hostname: os.hostname(),
      });
    });
  });
});
