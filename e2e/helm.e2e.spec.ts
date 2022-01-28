import path from 'path';
import {
  ElectronApplication, BrowserContext, _electron, Page, Locator
} from 'playwright';
import { test, expect } from '@playwright/test';
import {
  createDefaultSettings, kubectl, helm, tearDownHelm, playwrightReportAssets
} from './utils/TestUtils';
import { NavPage } from './pages/nav-page';

let page: Page;

test.describe.serial('Helm Deployment Test', () => {
  let electronApp: ElectronApplication;
  let context: BrowserContext;

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

  /**
   * helm teardown
   * It should run outside of the electronApp.close(), just to make sure the teardown won't
   * affect the shutdown process in case of exceptions/errors.
   */
  test.afterAll(tearDownHelm);

  test.afterAll(async() => {
    await context.tracing.stop({ path: playwrightReportAssets(path.basename(__filename)) });
    await electronApp.close();
  });

  test('should start loading the background services', async() => {
    const navPage = new NavPage(page);

    await navPage.progressBecomesReady();
    await expect(navPage.progressBar).toBeHidden();
  });

  test('should check kubernetes API is ready', async() => {
    const output = await kubectl('cluster-info');

    expect(output).toMatch(/is running at ./);
  });

  test('should add helm sample repository', async() => {
    const helmAddRepoOutput = await helm('repo', 'add', 'bitnami', 'https://charts.bitnami.com/bitnami');

    // Sanity check for local test execution
    // if the helm repository already exist locally
    if (helmAddRepoOutput.includes('already exists')) {
      expect(helmAddRepoOutput).toContain('"bitnami" already exists with the same configuration, skipping');
    } else {
      expect(helmAddRepoOutput).toContain('"bitnami" has been added to your repositories');
    }
  });
  test('should install helm sample application and check if it was deployed', async() => {
    const helmInstall = await helm('upgrade', '--install', '--wait', '--timeout=20m', 'nginx-sample',
      'bitnami/nginx', '--set=service.type=NodePort', '--set=volumePermissions.enabled=true');

    expect(helmInstall).toContain('STATUS: deployed');
  });
  test('should verify if the application is working properly', async() => {
    // Get Node IP address.
    const nodeIpAddress = (await kubectl('get', 'nodes', '--output=jsonpath={.items[0].status.addresses[0].address}')).trim();

    // Get Node Port number.
    const nodePortNumber = (await kubectl('get', '--namespace', 'default', '--output=jsonpath={.spec.ports[0].nodePort}', 'services', 'nginx-sample')).trim();

    const podName = (await kubectl('get', 'pods', '--output=name', '--namespace', 'default')).trim();

    // Check is the app is running
    const checkAppStatus = await kubectl('exec', '--namespace', 'default', '--stdin', '--tty',
      podName, '--', 'curl', '--fail', `${ nodeIpAddress }:${ nodePortNumber }`);

    expect(checkAppStatus).toContain('Welcome to nginx!');
  });
});
