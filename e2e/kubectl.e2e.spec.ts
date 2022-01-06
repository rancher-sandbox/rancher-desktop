import path from 'path';
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
    await context.tracing.stop({ path: path.join(defaultReportFolder, 'pw-trace.zip') });
    await electronApp.close();
  });

  test('should load Rancher Desktop App', async() => {
    mainTitle = page.locator(mainTitleSelector);

    await expect(mainTitle).toHaveText('Welcome to Rancher Desktop');
  });

  test('should start loading the background services', async() => {
    const progressBarSelector = page.locator('.progress');

    // Wait until progress bar show up. It takes roughly ~60s to start in CI
    await progressBarSelector.waitFor({ state: 'visible', timeout: 200_000 });
    // Wait until progress bar be detached. With that we can make sure the services were started
    await progressBarSelector.waitFor({ state: 'detached', timeout: 300_000 });
    await expect(progressBarSelector).toBeHidden();
  });

  test('should run Kubernetes on Rancher Desktop (kubectl)', async() => {
    const output = await kubectl('cluster-info');

    await expect(output).toMatch(/is running at ./);
  });

  test('should create a sample namespace', async() => {
    // check if the rd-nginx-demo exists and delete, otherwise it will be ignored
    await kubectl('delete', '--ignore-not-found', 'namespace', 'rd-nginx-demo');
    await kubectl('create', 'namespace', 'rd-nginx-demo');

    const namespaces = (await kubectl('get', 'namespace', '--output=name')).trim();
    const testNamespace = namespaces.split('\n');

    await expect(testNamespace).toContain('namespace/rd-nginx-demo');
  });
  test('should deploy sample nginx server', async() => {
    try {
      const yamlFilePath = path.join(path.dirname(__dirname), 'e2e', 'assets', 'k8s-deploy-sample', 'nginx-sample-app.yaml');

      await kubectl('apply', '--filename', yamlFilePath, '--namespace', 'rd-nginx-demo');
      await kubectl('wait', '--for=condition=available', '--namespace', 'rd-nginx-demo', 'deployment/nginx-app', '--timeout=200s');

      const podName = (await kubectl('get', 'pods', '--output=name', '--namespace', 'rd-nginx-demo')).trim();
      const checkAppStatus = await kubectl('exec', '--namespace', 'rd-nginx-demo', '-it', podName, '--', 'curl', '--fail', 'localhost');

      await expect(await kubectl('get', 'pods', '--output=name', '--namespace', 'rd-nginx-demo')).toBeTruthy();
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
    const nginxSampleNamespace = namespaces.split('\n');

    await expect(nginxSampleNamespace).not.toContain('namespace/rd-nginx-demo');
  });
});
