/*
 * This tests interactions with the extension front end.
 * An E2E test is required to have access to the web page context.
 */

import os from 'os';
import path from 'path';

import {
  ElectronApplication, Page, test, expect, JSHandle, TestInfo,
} from '@playwright/test';

import { NavPage } from './pages/nav-page';
import {
  getFullPathForTool, getResourceBinDir, reportAsset, retry, startSlowerDesktop, teardown,
} from './utils/TestUtils';

import { ContainerEngine, Settings } from '@pkg/config/settings';
import { spawnFile } from '@pkg/utils/childProcess';
import { Log } from '@pkg/utils/logging';

import type { BrowserView, BrowserWindow } from 'electron';

/** The top level source directory, assuming we're always running from the tree */
const srcDir = path.dirname(path.dirname(__filename));
const rdctl = getFullPathForTool('rdctl');

// On Windows there's an eval routine that treats backslashes as escape-sequence leaders,
// so it's better to replace them with forward slashes. The file can still be found,
// and we don't have to deal with unintended escape-sequence processing.
const execPath = process.execPath.replace(/\\/g, '/');

let console: Log;
const NAMESPACE = 'rancher-desktop-extensions';

test.describe.serial('Extensions', () => {
  let app: ElectronApplication;
  let page: Page;
  let isContainerd = false;

  async function ctrctl(...args: string[]) {
    let tool = getFullPathForTool('nerdctl');

    if (isContainerd) {
      args = ['--namespace', NAMESPACE].concat(args);
    } else {
      tool = getFullPathForTool('docker');
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

  test.beforeAll(async({ colorScheme }, testInfo) => {
    [app, page] = await startSlowerDesktop(testInfo, {
      containerEngine: { name: ContainerEngine.MOBY },
      kubernetes:      { enabled: false },
    });
    console = new Log(path.basename(__filename, '.ts'), reportAsset(testInfo, 'log'));
  });

  test.afterAll(({ colorScheme }, testInfo) => teardown(app, testInfo));

  // Set things up so console messages from the UI gets logged too.
  let currentTestInfo: TestInfo;

  test.beforeEach(({ browserName }, testInfo) => {
    currentTestInfo = testInfo;
  });
  test.beforeAll(() => {
    page.on('console', (message) => {
      console.error(`${ currentTestInfo.titlePath.join(' >> ') } >> ${ message.text() }`);
    });
  });

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

    await ctrctl('build', '--tag', 'rd/extension/everything', '--build-arg', 'variant=everything', dataDir);
    await spawnFile(rdctl, ['api', '-XPOST', '/v1/extensions/install?id=rd/extension/everything']);
  });

  test('use extension protocol handler', async() => {
    const result = await page.evaluate(async() => {
      const data = await fetch('x-rd-extension://72642f657874656e73696f6e2f65766572797468696e67/ui/dashboard-tab/ui/index.html');

      return await data.text();
    });

    expect(result).toContain('ddClient');
  });

  test.describe('extension API', () => {
    let view: JSHandle<BrowserView>;

    test('extension UI can be loaded', async() => {
      const window: JSHandle<BrowserWindow> = await app.browserWindow(page);

      await page.click('.nav .nav-item[data-id="extension:rd/extension/everything"]');

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

      await view.evaluate((v, { window }) => {
        v.webContents.addListener('console-message', (event, level, message, line, source) => {
          const levelName = (['verbose', 'info', 'warning', 'error'])[level];
          const outputMessage = `[${ levelName }] ${ message } @${ source }:${ line }`;

          window.webContents.executeJavaScript(`console.log(${ JSON.stringify(outputMessage) })`);
        });
      }, { window });
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

    test.describe('ddClient.extension.host.cli.exec', () => {
      const wrapperName = process.platform === 'win32' ? 'dummy.cmd' : 'dummy.sh';

      test('capturing output', async() => {
        const script = `
          ddClient.extension.host.cli.exec("${ wrapperName }", [
            "${ execPath }", "-e", "console.log(1 + 1)"
          ]).then(({cmd, killed, signal, code, stdout, stderr}) => ({
            /* Rebuild the object so it can be serialized properly */
            cmd, killed, signal, code, stdout, stderr
          }));
        `;
        const result = await evalInView(script);

        expect(result).toEqual(expect.objectContaining({
          cmd:    expect.stringContaining(wrapperName),
          code:   0,
          stdout: expect.stringContaining('2'),
          stderr: expect.stringContaining(''),
        }));
      });

      test('streaming output', async() => {
        const script = `
          (new Promise((resolve) => {
            let output = [], errors = [], exitCodes = [];
            ddClient.extension.host.cli.exec("${ wrapperName }", [
              "${ execPath }", "-e",
              "console.log(2 + 2); console.error(3 + 3);"],
              {
                stream: {
                  onOutput: (data) => {
                    output.push(data);
                  },
                  onError: (err) => {
                    errors.push(err);
                    resolve(output, errors, exitCodes);
                  },
                  onClose: (exitCode) => {
                    exitCodes.push(exitCode);
                    resolve({output, errors, exitCodes});
                  },
                }
            });
          })).catch(ex => ex);
        `;

        const result = await evalInView(script);

        expect(result).toEqual(expect.objectContaining({
          output: expect.arrayContaining([
            { stdout: expect.stringContaining('4') },
            { stderr: expect.stringContaining('6') },
          ]),
          errors:    [],
          exitCodes: [0],
        }));
      });
    });

    test.describe('ddClient.docker', () => {
      test('ddClient.docker.cli.exec', async() => {
        const script = `
          ddClient.docker.cli.exec("info", ["--format", "{{ json . }}"])
          .then(v => v.parseJsonObject())
          .then(j => JSON.stringify(j));
        `;
        const result = JSON.parse(await evalInView(script));

        expect(result).toEqual(expect.objectContaining({
          ID:          expect.any(String),
          Driver:      expect.any(String),
          Plugins:     expect.objectContaining({}),
          MemoryLimit: expect.any(Boolean),
          SwapLimit:   expect.any(Boolean),
          MemTotal:    expect.any(Number),
          OSType:      'linux',
        }));
      });
      test('ddClient.docker.listImages', async() => {
        const options = {
          digests:   true,
          namesapce: isContainerd ? NAMESPACE : undefined,
        };
        const script = `ddClient.docker.listImages(${ JSON.stringify(options) })`;
        const result = await evalInView(script);

        expect(result).toEqual(expect.arrayContaining([
          expect.objectContaining({
            Id:          expect.any(String),
            ParentId:    expect.any(String),
            RepoTags:    expect.arrayContaining(['rd/extension/everything:latest']),
            Created:     expect.any(Number),
            Size:        expect.any(Number),
            SharedSize:  expect.any(Number),
            VirtualSize: expect.anything(),
            Labels:      expect.any(Object),
            Containers:  expect.any(Number),
          }),
        ]));
      });
      test('ddClient.docker.listContainers', async() => {
        const options = {
          size:      !isContainerd, // nerdctl doesn't implement --size
          namespace: isContainerd ? NAMESPACE : undefined,
        };
        const script = `ddClient.docker.listContainers(${ JSON.stringify(options) })`;
        const result = await evalInView(script);
        const container = result.find((r: { Image: string; }) => r.Image.startsWith('rd/extension/everything'));

        // The playwright copy of expect() produces terrible error messages when
        // things don't match, making it difficult to find what was wrong.
        // Match properties individually to make things easier to spot.
        expect(container).toBeTruthy();
        expect(container).toHaveProperty('Id', expect.any(String));
        expect(container).toHaveProperty('Names', expect.arrayContaining([expect.any(String)]));
        expect(container).toHaveProperty('Image', expect.stringContaining('rd/extension/everything'));
        expect(container).toHaveProperty('ImageID', expect.any(String));
        expect(container).toHaveProperty('Command', expect.any(String));
        expect(container).toHaveProperty('Created', expect.any(Number));
        expect(container).toHaveProperty('Ports', expect.anything());
        expect(container).toHaveProperty('SizeRw', expect.any(Number));
        expect(container).toHaveProperty('SizeRootFs', expect.any(Number));
        expect(container).toHaveProperty('Labels', expect.any(Object));
        expect(container).toHaveProperty('State', expect.any(String));
        expect(container).toHaveProperty('Status', expect.any(String));
        expect(container).toHaveProperty('HostConfig', expect.any(Object));
        expect(container).toHaveProperty('NetworkSettings', expect.any(Object));
        expect(container).toHaveProperty('Mounts', expect.any(Array));
      });
    });

    test.describe('ddClient.extension.vm.cli.exec', () => {
      test('capturing output', async() => {
        const script = `
          ddClient.extension.vm.cli.exec("/bin/echo", ["xyzzy"])
          .then(v => JSON.stringify(v))
        `;
        const result = JSON.parse(await evalInView(script));

        expect(result).toEqual(expect.objectContaining({
          stdout: 'xyzzy\n',
          code:   0,
        }));
      });
    });

    test.describe('ddClient.extension.vm.service', () => {
      test('can fetch from the backend', async() => {
        const url = '/etc/os-release';

        await retry(async() => {
          const result = evalInView(`ddClient.extension.vm.service.get("${ url }")`);

          await expect(result).resolves.toContain('VERSION_ID');
        });
      });
      test('can fetch from external sources', async() => {
        const url = 'http://127.0.0.1:6120/LICENSES'; // dashboard

        await retry(async() => {
          const result = evalInView(`ddClient.extension.vm.service.get("${ url }")`);

          await expect(result).resolves.toContain('Copyright');
        });
      });
    });
  });
});
