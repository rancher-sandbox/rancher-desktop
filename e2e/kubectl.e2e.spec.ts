import path from 'path';
import {
  ElectronApplication, BrowserContext, _electron, Page, Locator
} from 'playwright';
import { test, expect } from '@playwright/test';
import { TestUtils } from './utils/TestUtils';
import * as tools from './utils/ToolsUtils';

let page: Page;
const defaultReportFolder = path.join(__dirname, 'reports/');

test.describe.serial('Rancher Desktop - K8s Deploy Test', () => {
  let mainTitle: Locator;
  let utils: TestUtils;
  let electronApp: ElectronApplication;
  let context: BrowserContext;

  const mainTitleSelector = '[data-test="mainTitle"]';

  test.beforeAll(async() => {
    utils = new TestUtils();
    utils.createDefaultSettings();

    electronApp = await _electron.launch({
      args: [
        path.join(__dirname, '../'),
        '--disable-gpu',
        '--whitelisted-ips=',
        '--disable-dev-shm-usage',
      ]
    });
    context = electronApp.context();

    await context.tracing.start({ screenshots: true, snapshots: true });
    page = await electronApp.firstWindow();
  });

  test.afterAll(async() => {
    await context.tracing.stop({ path: `${ defaultReportFolder }pw-trace.zip` });
    await electronApp.close();
  });

  test('should load Rancher Desktop App', async() => {
    mainTitle = page.locator(mainTitleSelector);

    await expect(mainTitle).toHaveText('Welcome to Rancher Desktop');
  });

  test('should start loading the background services', async() => {
    const progressBarSelector = page.locator('.progress');

    await progressBarSelector.waitFor({ state: 'detached', timeout: 300_000 });
    await expect(progressBarSelector).toBeHidden();
  });

  test('should run Kubernetes on Rancher Desktop (kubectl)', async() => {
    // CI take longer than local env to start up
    // giving it some time to proper start the background services
    if (process.env.CI) {
      console.log('Waiting for services - CI take a while to load...');
      await utils.delay(200_000);
    }
    const output = await tools.kubectl('cluster-info');

    expect(output).toMatch(/is running at ./);
  });

  test('should create a sample namespace', async() => {
    const getExistingNamespaces = (await tools.kubectl('get', 'namespace', '--output=name')).trim();

    try {
      if (getExistingNamespaces.includes('rd-nginx-demo')) {
        await tools.kubectl('delete', 'ns', 'rd-nginx-demo');
      }
      await tools.kubectl('create', 'namespace', 'rd-nginx-demo');
    } finally {
      const namespaces = (await tools.kubectl('get', 'namespace', '--output=name')).trim();

      expect(namespaces).toMatch(/rd-nginx-demo/);
    }
  });
  test('should deploy sample nginx server', async() => {
    try {
      const yamlFilePath = path.join(path.dirname(__dirname), 'e2e', 'assets', 'k8s-deploy-sample', 'nginx-sample-app.yaml');

      await tools.kubectl('apply', '-f', yamlFilePath, '-n', 'rd-nginx-demo');

      for (let i = 0; i < 10; i++) {
        const podName = (await tools.kubectl('get', 'pods', '--output=name', '-n', 'rd-nginx-demo')).trim();

        if (podName) {
          expect(podName).not.toBeFalsy();
          break;
        }
        await utils.delay(5_000);
      }
      await tools.kubectl('wait', '--for=condition=ready', 'pod', '-l', 'app=nginx', '-n', 'rd-nginx-demo', '--timeout=200s');
      const podName = (await tools.kubectl('get', 'pods', '--output=name', '-n', 'rd-nginx-demo')).trim();
      const checkAppStatus = await tools.kubectl('exec', '-n', 'rd-nginx-demo', '-it', podName, '--', 'curl', 'localhost');

      expect(checkAppStatus).toBeTruthy();
      expect(checkAppStatus).toContain('Welcome to nginx!');
    } catch (err:any) {
      console.error('Error: ');
      console.error(`stdout: ${ err.stdout }`);
      console.error(`stderr: ${ err.stderr }`);
      throw err;
    }
  });

  test('should delete sample namespace', async() => {
    await tools.kubectl('delete', 'namespace', 'rd-nginx-demo');
    const namespaces = (await tools.kubectl('get', 'namespace', '--output=name')).trim();

    expect(namespaces).not.toMatch(/rd-nginx-demo/);
  });
});
