import fs from 'fs';
import os from 'os';
import path from 'path';
import fetch from 'node-fetch';
import { ElectronApplication, BrowserContext, _electron, Page } from 'playwright';
import { test, expect } from '@playwright/test';
import {
  createDefaultSettings, tearDownHelm, playwrightReportAssets, setUpHelmCustomEnv, helm, kubectl,
} from './utils/TestUtils';
import { NavPage } from './pages/nav-page';
import * as childProcess from '@/utils/childProcess';

let page: Page;
let skipRestOfTests = false;

test.describe.serial('Epinio Install Test', () => {
  // Disabling this test for linux and windows - See https://github.com/rancher-sandbox/rancher-desktop/issues/1634
  test.skip(os.platform().startsWith('linux') || os.platform().startsWith('win'), 'Need further investigation on Linux runner');
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

  test.afterAll(tearDownEpinio);

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
    let epinioInstall = '';

    try {
      epinioInstall = await helm('install', 'epinio-installer', 'epinio/epinio-installer',
        '--set', 'skipTraefik=true', '--set', `domain=${ loadBalancerIpAddr }.omg.howdoi.website`,
        '--wait', '--timeout=25m');
    } catch(err) {
      console.log(`Failed to install epinio: ${ err }`);
      skipRestOfTests = true;
    }
    expect(epinioInstall)
      .toContain('STATUS: deployed');
  });
  test('should update epinio config certs file', async() => {
    test.skip(skipRestOfTests, 'No point continuing');
    const epinioConfigUpdate = await epinio('config', 'update');

    expect(epinioConfigUpdate).toContain('Ok');
  });
  test('should push a sample app through epinio cli', async() => {
    test.skip(skipRestOfTests, 'No point continuing');
    const epinioPush = await epinio('push', '--name', 'sample', '--path', path.join(__dirname, 'assets', 'sample-app'));

    expect(epinioPush).toContain('App is online.');
  });
  test('should verify deployed sample application is reachable', async() => {
    test.skip(skipRestOfTests, 'No point continuing');
    const loadBalancerIpAddr = await loadBalancerIp();
    const urlAddr = `https://sample.${ loadBalancerIpAddr }.omg.howdoi.website`;
    // Epinio will use a self-signed cert here; ignore the certificate error.
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
  // Don't worry about line-boundaries here -- there is no line starting with a prefix like
  // BobsLoadBalancer Ingress:...
  const m = /LoadBalancer Ingress:\s+([0-9.]+)/.exec(serviceInfo);

  // checking if it will be undefined, null, 0 or empty
  if (m) {
    return m[1];
  } else {
    console.log('Cannot find load balancer IP address.');
  }
}

const platforms: Record<string, string> = {
  darwin: 'darwin', win32: 'win32', linux: 'linux'
};

export async function installEpinioCli() {
  const platform = os.platform() as string;

  if (!platforms[platform]) {
    console.error(`Platform type not detect. Found: ${ platform }`);
  }

  // Download epinio binary based on platform type
  await downloadEpinioBinary(platform);
}

/**
 * Download epinio binary based on the platform type and save the binary
 * into a temporary folder.
 */
export async function downloadEpinioBinary( platformType: string) {
  // Create a temp folder for epinio binary
  const epinioTempFolder = path.join(os.tmpdir(), 'epinio');
  const executableNames: Record<string, string> = {
    'darwin-arm64': 'epinio-darwin-arm64',
    'darwin-x64':   'epinio-darwin-x86_64',
    'linux-x64':    'epinio-linux-x86_64',
    'win32-x64':    'epinio-windows-amd64.exe',
  };
  const epinioWorkingVersion = 'v0.5.0';
  const key = `${os.platform()}-${os.arch()}`;
  const executableName = executableNames[key];

  if (!executableName) {
    throw new Error(`Could not download epinio client for unknown platform ${ key }`);
  }
  fs.mkdirSync(epinioTempFolder, { recursive: true });
  await downloadEpinioCommand(epinioWorkingVersion, executableName, epinioTempFolder);
}


async function fetchWithRetry(url: string) {
  while (true) {
    try {
      return await fetch(url);
    } catch (ex: any) {
      if (ex && ex.errno === 'EAI_AGAIN') {
        console.log(`Recoverable error downloading ${ url }, retrying...`);
        continue;
      }
      console.dir(ex);
      throw ex;
    }
  }
}

/**
 * Download latest epinio cli binary and make it executable
 */
export async function downloadEpinioCommand(version: string, platform: string, folder: string) {
  const epinioUrl = 'https://github.com/epinio/epinio/releases/download/';
  const response = await fetchWithRetry(`${ epinioUrl }${ version }/${ platform }`);

  if (!os.platform().startsWith('win')) {
    fs.writeFileSync(`${ folder }/epinio`, await response.text(), { mode: 0o755 });
  } else {
    const winPath = path.resolve(folder);
    fs.writeFileSync(`${ winPath }/epinio.zip`, await response.text());
    await unzip('-o', `${ winPath }\\epinio.zip`, 'epinio.exe', '-d', folder);
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
export async function globalTool(tool: string, ...args: string[]): Promise<string> {
  try {
    const { stdout } = await childProcess.spawnFile(
      tool, args, { stdio: ['ignore', 'pipe', 'inherit'] });

    return stdout;
  } catch (ex:any) {
    console.error(`Error running ${ tool } ${ args.join(' ') }: ${ ex }`);
    if (ex.stdout) {
      console.error(`stdout: ${ ex.stdout }`);
    }
    if (ex.stderr) {
      console.error(`stderr: ${ ex.stderr }`);
    }
    throw ex;
  }
}

export async function curl(...args: string[] ): Promise<string> {
  return await globalTool('curl', ...args);
}

export async function unzip(...args: string[] ): Promise<string> {
  return await globalTool('unzip', ...args);
}

export async function epinio(...args: string[] ): Promise<string> {
  const epinioTempFolder = path.join(os.tmpdir(), 'epinio');
  const filename = os.platform().startsWith('win') ? 'epinio.exe' : 'epinio';
  const exec = path.join(epinioTempFolder, filename);

  return await globalTool(exec, ...args);
}
