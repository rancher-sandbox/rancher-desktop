/**
 * TestUtils exports functions required for the E2E test specs.
 */
import os from 'os';
import fs from 'fs';
import path from 'path';
import paths from '../../src/utils/paths';
import * as childProcess from '../../src/utils/childProcess';

/**
 * Create empty default settings to bypass gracefully
 * FirstPage window.
 */
export function createDefaultSettings() {
  createSettingsFile(paths.config);
}

function createSettingsFile(settingsDir: string) {
  const settingsData = '{}';
  const settingsJson = JSON.stringify(settingsData);
  const fileSettingsName = 'settings.json';
  const settingsFullPath = path.join(settingsDir, fileSettingsName);

  if (!fs.existsSync(settingsFullPath)) {
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(path.join(settingsDir, fileSettingsName), settingsJson);
    console.log('Default settings file successfully created on: ', `${ settingsDir }/${ fileSettingsName }`);
  } else {
    try {
      const contents = fs.readFileSync(settingsFullPath, { encoding: 'utf-8' });
      const settings = JSON.parse(contents.toString());

      if (settings.kubernetes?.enabled === false) {
        console.log(`Warning: updating settings.kubernetes.enabled to true.`);
        settings.kubernetes.enabled = true;
        fs.writeFileSync(settingsFullPath, JSON.stringify(settings), { encoding: 'utf-8' });
      }
    } catch (err) {
      console.log(`Failed to process ${ settingsFullPath }: ${ err }`);
    }
  }
}

/**
 * Create playwright trace package based on the spec file name.
 * @returns path string along with spec file
 * @example main.e2e.spec.ts-pw-trace.zip
 */
export function playwrightReportAssets(fileName: string) {
  return path.join(__dirname, '..', 'reports', `${ fileName }-pw-trace.zip`);
}

/**
 * Custom helm home and cache directories
 * Matt tip that will help to remove all helm test data from the SUT
 */
export function setUpHelmCustomEnv() {
  const tempHelmFolder = path.join(os.homedir(), 'helmTmp');
  const helmRepoCacheFolder = path.join(tempHelmFolder, 'Caches', 'helm', 'repository');
  const helmRepoConfigFolder = path.join(tempHelmFolder, 'Config', 'helm', 'repository');

  process.env.HELM_REPOSITORY_CACHE = helmRepoCacheFolder;
  process.env.HELM_REPOSITORY_CONFIG = `${ helmRepoConfigFolder }/repositories.yaml`;

  if (!fs.existsSync(tempHelmFolder)) {
    fs.mkdirSync(tempHelmFolder, { recursive: true });
  }
}

/**
 * helm teardown
 * it ensure that all helm test installation contents will be deleted.
 */
export function tearDownHelm() {
  const helmTempPath = path.join(os.homedir(), 'helmTmp');

  if (fs.existsSync(helmTempPath)) {
    fs.rmSync(helmTempPath, { recursive: true });
  }
}

/**
 * Run the given tool with the given arguments, returning its standard output.
 */
export async function tool(toolToRun: string, ...args: string[]): Promise<string> {
  const srcDir = path.dirname(__dirname);
  const filename = os.platform().startsWith('win') ? `${ toolToRun }.exe` : toolToRun;
  const exe = path.join(srcDir, '..', 'resources', os.platform(), 'bin', filename);

  try {
    const { stdout } = await childProcess.spawnFile(
      exe, args, { stdio: ['ignore', 'pipe', 'inherit'] });

    return stdout;
  } catch (ex:any) {
    console.error(`Error running ${ toolToRun } ${ args.join(' ') }: error: ${ ex }`);
    if (ex.stdout) {
      console.error(`stdout: ${ ex.stdout }`);
    }
    if (ex.stderr) {
      console.error(`stderr: ${ ex.stderr }`);
    }
    throw ex;
  }
}

/**
 * Run `kubectl` with given arguments.
 * @returns standard output of the command.
 * @example await kubectl('version')
 */
export async function kubectl(...args: string[] ): Promise<string> {
  return await tool('kubectl', '--context', 'rancher-desktop', ...args);
}

/**
 * Run `helm` with given arguments.
 * @returns standard output of the command.
 * @example await helm('version')
 */
export async function helm(...args: string[] ): Promise<string> {
  return await tool('helm', '--kube-context', 'rancher-desktop', ...args);
}
