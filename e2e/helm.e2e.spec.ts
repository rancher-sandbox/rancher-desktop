import path from 'path';
import util from 'util';
import {
  ElectronApplication, BrowserContext, _electron, Page, Locator
} from 'playwright';
import { test, expect } from '@playwright/test';
import { createDefaultSettings, kubectl, helm } from './utils/TestUtils';

let page: Page;
const defaultReportFolder = path.join(__dirname, 'reports/');

test.describe.serial('Helm Deployment Test', () => {
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

  test('should check kubernetes API is ready', async() => {
    const output = await kubectl('cluster-info');

    // Check if the node is ready.
    let nodeName = '';

    for (let i = 0; i < 10; i++) {
      nodeName = (await kubectl('get', 'nodes', '--output=name')).trim();
      if (nodeName) {
        break;
      }
      await util.promisify(setTimeout)(5_000);
    }
    expect(nodeName).not.toBeFalsy();
    await kubectl('wait', '--for=condition=Ready', nodeName);

    await expect(output).toMatch(/is running at ./);
  });

  test('should add helm sample repository', async() => {
    const helmAddRepoOutput = await helm('repo', 'add', 'bitnami', 'https://charts.bitnami.com/bitnami');

    // Sanity check for local test execution
    // if the helm repository already exist locally
    if (helmAddRepoOutput.includes('already exists')) {
      await expect(helmAddRepoOutput).toContain('"bitnami" already exists with the same configuration, skipping');
    } else {
      await expect(helmAddRepoOutput).toContain('"bitnami" has been added to your repositories');
    }
  });
  test('should install helm sample application and check if it was deployed', async() => {
    const helmInstall = await helm('install', '--wait', '--timeout=20m', 'nginx-sample',
      'bitnami/nginx', '--set=service.type=NodePort', '--set=volumePermissions.enabled=true');

    await expect(helmInstall).toContain('STATUS: deployed');
  });
  test('should verify if the application was properly deployed/installed', async() => {
    // Get Node IP address.
    const nodeIpAddress = (await kubectl('get', 'nodes', '--namespace', 'default', '--output=jsonpath={.items[0].status.addresses[0].address}')).trim();

    // Get Node Port number.
    const nodePortNumber = (await kubectl('get', '--namespace', 'default', '--output=jsonpath={.spec.ports[0].nodePort}', 'services', 'nginx-sample')).trim();

    const podName = (await kubectl('get', 'pods', '--output=name', '--namespace', 'default')).trim();

    // Check is the app is running
    const checkAppStatus = await kubectl('exec', '--namespace', 'default', '-it', podName, '--', 'curl', '--fail', `${ nodeIpAddress }:${ nodePortNumber }`);

    await expect(checkAppStatus).toContain('Welcome to nginx!');
  });
  test('should uninstall sample application', async() => {
    const removeHelmServices = (await kubectl('delete', 'all', '--all', '--namespace', 'default')).trim();
    const helmRepoRemove = (await helm('repo', 'remove', 'bitnami')).trim();

    await expect(removeHelmServices).toContain('deployment.apps "nginx-sample" deleted');
    await expect(helmRepoRemove).toContain('"bitnami" has been removed from your repositories');
  });
});
