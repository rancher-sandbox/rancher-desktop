import os from 'os';
import path from 'path';
import util from 'util';
import fetch from 'node-fetch';
import { Application } from 'spectron';
import * as childProcess from '../src/utils/childProcess';
import NavBarPage from './pages/navbar';
import { TestUtils } from './utils/TestUtils';

process.env.K8STEST = 'rd-k8s-testing';

async function tool(tool: string, ...args: string[]): Promise<string> {
  const srcDir = path.dirname(__dirname);
  const filename = os.platform().startsWith('win') ? `${ tool }.exe` : tool;
  const exe = path.join(srcDir, 'resources', os.platform(), 'bin', filename);

  try {
    const { stdout } = await childProcess.spawnFile(
      exe, args, { stdio: ['ignore', 'pipe', 'inherit'] });

    return stdout;
  } catch (ex:any) {
    console.error(`Error running ${ tool } ${ args.join(' ') }`);
    console.error(`stdout: ${ ex.stdout }`);
    console.error(`stderr: ${ ex.stderr }`);
    throw ex;
  }
}

async function kubectl(...args: string[] ): Promise<string> {
  return await tool('kubectl', ...args);
}

describe('Rancher Desktop - K8s Sample Deployment Test', () => {
  let app: Application;
  let utils: TestUtils;
  let navBarPage: NavBarPage;

  beforeAll(async() => {
    utils = new TestUtils();
    utils.setupJestTimeout();
    app = await utils.setUp();
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

  it('should load Rancher Desktop App', async() => {
    await app.client.waitUntilWindowLoaded();

    // Wait till the window is fully loaded n till it gets the title 'Rancher Desktop'
    for (let i = 0; i < 10; i++) {
      const windowTitle = (await app.browserWindow.getTitle()).trim();

      if (windowTitle === 'Rancher Desktop') {
        break;
      }
      await util.promisify(setTimeout)(5_000);
    }
    const title = await app.browserWindow.getTitle();

    expect(title).toBe('Rancher Desktop');
  });

  it('should run Kubernetes on Rancher Desktop', async() => {
    await app.client.waitUntilWindowLoaded();
    const progress = await app.client.$('.progress');

    // Wait for the progress bar to exist
    await progress.waitForExist({ timeout: 15_000 });
    // Wait for progress bar to disappear again
    await progress.waitForExist({ timeout: 600_000, reverse: true });

    const output = await kubectl('cluster-info');
    // Filter out ANSI escape codes (colours).
    const filteredOutput = output.replaceAll(/\033\[.*?m/g, '');

    expect(filteredOutput).toMatch(/ is running at ./);
  });

  it('should create a sample namespace', async() => {
    try {
      await kubectl('create', 'namespace', 'rd-nginx-demo');
    } finally {
      const namespaces = (await kubectl('get', 'namespace', '--output=name')).trim();
      const filteredNamespaces = namespaces.replaceAll(/\033\[.*?m/g, '');

      expect(filteredNamespaces).toContain('rd-nginx-demo');
    }
  });

  it('should deploy nginx server sample', async() => {
    try {
      const yamlFilePath = path.join(path.dirname(__dirname), 'e2e', 'fixtures', 'k8s-deploy-sample', 'nginx-sample-app.yaml');

      await kubectl('apply', '-f', yamlFilePath, '-n', 'rd-nginx-demo');

      for (let i = 0; i < 10; i++) {
        const podName = (await kubectl('get', 'pods', '--output=name', '-n', 'rd-nginx-demo')).trim();

        if (podName) {
          expect(podName).not.toBeFalsy();
          break;
        }
        await util.promisify(setTimeout)(5_000);
      }
      await kubectl('wait', '--for=condition=ready', 'pod', '-l', 'app=nginx', '-n', 'rd-nginx-demo', '--timeout=120s');

      if (os.platform().startsWith('win')) {
        // Forward port via UI button click, and capture the port number
        const portForwardingPage = await navBarPage.getPortForwardingPage();
        const port = await portForwardingPage?.portForward();

        // Access app and check the welcome message
        const response = await fetch(`http://localhost:${ port }`);

        expect(response.ok).toBeTruthy();
        response.text().then((text) => {
          expect(text).toContain('Welcome to nginx!');
        });
      } else {
        const podName = (await kubectl('get', 'pods', '--output=name', '-n', 'rd-nginx-demo')).trim();
        const checkAppStatus = await kubectl('exec', '-n', 'rd-nginx-demo', '-it', podName, '--', 'curl', 'localhost');

        expect(checkAppStatus).toBeTruthy();
        expect(checkAppStatus).toContain('Welcome to nginx!');
      }
    } catch (err:any) {
      console.error('Error: ');
      console.error(`stdout: ${ err.stdout }`);
      console.error(`stderr: ${ err.stderr }`);
      throw err;
    }
  });

  it('should delete sample namespace', async() => {
    await kubectl('delete', 'namespace', 'rd-nginx-demo');
    const namespaces = (await kubectl('get', 'namespace', '--output=name')).trim();
    const filteredNamespaces = namespaces.replaceAll(/\033\[.*?m/g, '');

    expect(filteredNamespaces).not.toContain('rd-nginx-demo');
  });
});
