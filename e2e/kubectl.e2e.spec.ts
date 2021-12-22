import path from 'path';
import util from 'util';
import {
  ElectronApplication, BrowserContext, _electron, Page, Locator
} from 'playwright';
import { test, expect } from '@playwright/test';
import { createDefaultSettings, kubectl } from './utils/TestUtils';

let page: Page;
const defaultReportFolder = path.join(__dirname, 'reports/');

test.describe.serial('K8s Deployment Test', () => {
  let mainTitle: Locator;
  let electronApp: ElectronApplication;
  let context: BrowserContext;

  const mainTitleSelector = '[data-test="mainTitle"]';

  test.beforeAll(async() => {
    createDefaultSettings();

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
    const output = await kubectl('cluster-info');

    await expect(output).toMatch(/is running at ./);
  });

  test('should create a sample namespace', async() => {
    const existingNamespaces = (await kubectl('get', 'namespace', '--output=name')).trim();
    const testNamespace = existingNamespaces.split('namespace/');

    try {
      if (testNamespace.includes('rd-nginx-demo')) {
        await kubectl('delete', '--ignore-not-found', 'namespace', 'rd-nginx-demo');
      }
      await kubectl('create', 'namespace', 'rd-nginx-demo');
    } finally {
      const namespaces = (await kubectl('get', 'namespace', '--output=name')).trim();
      const nginxNamespace = namespaces.split('namespace/');

      await expect(nginxNamespace).toContain('rd-nginx-demo');
    }
  });
  test('should deploy sample nginx server', async() => {
    try {
      const yamlFilePath = path.join(path.dirname(__dirname), 'e2e', 'assets', 'k8s-deploy-sample', 'nginx-sample-app.yaml');

      await kubectl('apply', '--filename', yamlFilePath, '--namespace', 'rd-nginx-demo');

      for (let i = 0; i < 10; i++) {
        const podName = (await kubectl('get', 'pods', '--output=name', '--namespace', 'rd-nginx-demo')).trim();

        if (podName) {
          // expect(podName).not.toBeFalsy();
          await expect(podName).toBeTruthy();
          break;
        }
        // Playwrigth does not have control of external tools (kubectl),
        // and it requires a delay until the pod being healthy.
        await util.promisify(setTimeout)(3_000);
      }
      await kubectl('wait', '--for=condition=ready', 'pod', '-l', 'app=nginx', '--namespace', 'rd-nginx-demo', '--timeout=200s');
      const podName = (await kubectl('get', 'pods', '--output=name', '-n', 'rd-nginx-demo')).trim();
      const checkAppStatus = await kubectl('exec', '--namespace', 'rd-nginx-demo', '-it', podName, '--', 'curl', '--fail', 'localhost');

      await expect(checkAppStatus).toContain('Welcome to nginx!');
    } catch (err:any) {
      console.error('Error: ');
      console.error(`stdout: ${ err.stdout }`);
      console.error(`stderr: ${ err.stderr }`);
      throw err;
    }
  });

  test('should delete sample namespace', async() => {
    await kubectl('delete', 'namespace', 'rd-nginx-demo');
    const namespaces = (await kubectl('get', 'namespace', '--output=name')).trim();
    const nginxSampleNamespace = namespaces.split('namespace/');

    await expect(nginxSampleNamespace).not.toContain('rd-nginx-demo');
  });
});
