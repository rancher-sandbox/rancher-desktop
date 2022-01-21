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
 * helm teardown
 * it ensure that all helm test installation contents will be deleted.
 */
export async function tearDownHelm() {
  await helm('repo', 'remove', 'bitnami');
  await kubectl('delete', 'deploy', 'nginx-sample', '--namespace', 'default');
}

/**
 * Run the given tool with the given arguments, returning its standard output.
 */
export async function tool(tool: string, ...args: string[]): Promise<string> {
  const srcDir = path.dirname(__dirname);
  const filename = os.platform().startsWith('win') ? `${ tool }.exe` : tool;
  const exe = path.join(srcDir, '..', 'resources', os.platform(), 'bin', filename);

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

/**
 * Run `kubectl` with given arguments.
 * @returns standard output of the command.
 * @example await kubectl('version')
 */
export async function kubectl(...args: string[] ): Promise<string> {
  return await tool('kubectl', ...args);
}

/**
 * Run `helm` with given arguments.
 * @returns standard output of the command.
 * @example await helm('version')
 */
export async function helm(...args: string[] ): Promise<string> {
  return await tool('helm', ...args);
}
