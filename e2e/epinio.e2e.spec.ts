import path from 'path';
import fs from 'fs';
import os from 'os';
import { ElectronApplication, BrowserContext, _electron, Page } from 'playwright';
import { test, expect } from '@playwright/test';
import {
  createDefaultSettings, tearDownHelm, playwrightReportAssets, setUpHelmCustomEnv, helm, kubectl, detectPlatform,
} from './utils/TestUtils';
import { NavPage } from './pages/nav-page';
import * as childProcess from '@/utils/childProcess';

let page: Page;

test.describe.serial('Epinio Install Test', () => {
  let electronApp: ElectronApplication;
  let context: BrowserContext;

  test.beforeAll(async() => {
    installEpinioCli();
    createDefaultSettings();
    setUpHelmCustomEnv();

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

  /**
   * epinio teardown
   * It removes epinio binary temp folder along with its binary and
   * perform a helm uninstall epinio-installer.
   */
  test.afterAll(tearDownEpinio);

  test.afterAll(async() => {
    await context.tracing.stop({ path: playwrightReportAssets(path.basename(__filename)) });
    await electronApp.close();
  });

  test('should start loading the background services', async() => {
    const navPage = new NavPage(page);

    await navPage.progressBecomesReady();
    await expect(navPage.progressBar).toBeHidden();
  });
  test('should verify epinio cli was properly installed', async() => {
    const epinioCliStatus = await epinio('version');

    expect(epinioCliStatus).toContain('Epinio Version');
  });
  test('should add epinio-installer helm repository', async() => {
    const epinioRepoAdd = await helm('repo', 'add', 'epinio', 'https://epinio.github.io/helm-charts');

    expect(epinioRepoAdd).toContain('"epinio" has been added to your repositories');
  });
  test('should install epinio-installer application', async() => {
    const loadBalancerIpAddr = await loadBalancerIp();
    const epinioInstall = await helm('install', 'epinio-installer', 'epinio/epinio-installer',
      '--set', 'skipTraefik=true', '--set', `domain=${ loadBalancerIpAddr }.omg.howdoi.website`,
      '--wait', '--timeout=25m');

    expect(epinioInstall).toContain('STATUS: deployed');
  });
  test('should update epinio config certs file', async() => {
    const epinioConfigUpdate = await epinio('config', 'update');

    expect(epinioConfigUpdate).toContain('Ok');
  });
  test('should push a sample app through epinio cli', async() => {
    const epinioPush = await epinio('push', '--name', 'sample', '--path', './e2e/assets/sample-app');

    expect(epinioPush).toContain('App is online.');
  });
  test('should verify deployed sample application is reachable', async() => {
    const loadBalancerIpAddr = await loadBalancerIp();
    const urlAddr = `https://sample.${ loadBalancerIpAddr }.omg.howdoi.website`;
    // In order to avoid error 60 (SSL Cert error), passing "--insecure"
    const sampleApp = await curl('--fail', '--insecure', urlAddr);

    expect(sampleApp).toContain('PHP Version');
  });
});

/**
 * Helper to identify the Load Balancer IP Address.
 * It will return the traefik IP address, required by epinio install.
 */
export async function loadBalancerIp() {
  const serviceInfo = await kubectl('describe', 'service', 'traefik', '--namespace', 'kube-system');
  const serviceFiltered = serviceInfo.split('\n').toString();
  const ipAddrRegex = /(LoadBalancer Ingress:)\s+(((?:[0-9]{1,3}\.){3}[0-9]{1,3}))/;
  const regex = new RegExp(`${ ipAddrRegex.source }`);
  const ipAddressLb = regex.exec(serviceFiltered);

  // checking if it will be undefined, null, 0 or empty
  if (typeof ipAddressLb !== 'undefined' && ipAddressLb) {
    return ipAddressLb[2];
  } else {
    console.log('Cannot find load balancer IP address.');
  }
}

export async function installEpinioCli() {
  // Should detect which OS we're running this spec in and download the correct binary dynamically
  const platform = detectPlatform();

  // Download epinio binary based on platform type
  await downloadEpinioBinary(platform as string);
}

/**
 * Download epinio binary based on the platform type and save the binary
 * into a temporary folder.
 */
export async function downloadEpinioBinary( platformType: string) {
  // Setting up epinio binaries names per platform
  const epinioDarwin = 'epinio-darwin-x86_64';
  const epinioDarwinArm = 'epinio-darwin-arm64';
  const epinioLinux = 'epinio-linux-x86_64';
  const epinioWin = 'epinio-windows-amd64.exe';

  // Get epinio releases versions and filter the version by tag, e.g: v0.3.6
  const epinioTagsPayload = await curl('https://api.github.com/repos/epinio/epinio/releases', '--fail', '--silent');
  const filterOutput = epinioTagsPayload.replace('\n', '');
  const parsedJson = JSON.parse(filterOutput);
  // Bring the latest epinio version from the payload, assuming LIFO method.
  const epinioLatestVersion = parsedJson[0]['name'];

  // Create a temp folder for epinio binary
  const epinioTempFolder = path.join(os.homedir(), 'epinio-tmp');

  if (!fs.existsSync(epinioTempFolder)) {
    fs.mkdirSync(epinioTempFolder, { recursive: true });
  }

  // Detect CPU arch
  const cpuArch = os.arch();

  switch (platformType) {
  case 'darwin':
    if (cpuArch === 'x64') {
      await downloadEpinioCommand(epinioLatestVersion, epinioDarwin, epinioTempFolder);
      break;
    } else {
      await downloadEpinioCommand(epinioLatestVersion, epinioDarwinArm, epinioTempFolder);
      break;
    }
  case 'linux':
    await downloadEpinioCommand(epinioLatestVersion, epinioLinux, epinioTempFolder);
    break;
  case 'win32':
    await downloadEpinioCommand(epinioLatestVersion, epinioWin, epinioTempFolder);
    break;
  }
}

/**
 * Download latest epinio cli binary and makes it executable
 */
export async function downloadEpinioCommand(version: string, platform: string, folder: string) {
  const epinioUrl = 'https://github.com/epinio/epinio/releases/download/';

  if (!os.platform().startsWith('win32')) {
    await curl('--fail', '--location', `${ epinioUrl }${ version }/${ platform }`, '--output', `${ folder }\/epinio`);
    const stat = fs.statSync(`${ folder }\/epinio`).mode;

    fs.chmodSync(`${ folder }\/epinio`, stat | 0o755);
  } else {
    await curl('--fail', '--location', `${ epinioUrl }${ version }/${ platform }`, '--output', `${ folder }\/epinio.exe`);
  }
}

/**
 * Gracefully remove epinio temp folder and uninstall all epinio-install resources
 */
export async function tearDownEpinio() {
  const epinioTempFolder = path.join(os.homedir(), 'epinio-tmp');

  if (fs.existsSync(epinioTempFolder)) {
    fs.rmSync(epinioTempFolder, { recursive: true, maxRetries: 10 });
  }

  await helm('uninstall', 'epinio-installer', '--wait', '--timeout=20m');
}

/**
 * Run the given tool with the given arguments, returning its standard output.
 */
export async function tool(tool: string, ...args: string[]): Promise<string> {
  try {
    const { stdout } = await childProcess.spawnFile(
      tool, args, { stdio: ['ignore', 'pipe', 'inherit'] });

    return stdout;
  } catch (ex:any) {
    console.error(`Error running ${ tool } ${ args.join(' ') }`);
    console.error(`stdout: ${ ex.stdout }`);
    console.error(`stderr: ${ ex.stderr }`);
    throw ex;
  }
}

export async function curl(...args: string[] ): Promise<string> {
  return await tool('curl', ...args);
}

export async function epinio(...args: string[] ): Promise<string> {
  const epinioTmpDir = path.join(os.homedir(), 'epinio-tmp');
  const filename = os.platform().startsWith('win') ? 'epinio.exe' : 'epinio';
  const exec = path.join(epinioTmpDir, filename as string);

  return await tool(exec, ...args);
}
