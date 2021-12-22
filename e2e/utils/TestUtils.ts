/**
 * TestUtils exports functions required for the E2E test specs
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { DarwinPaths, LinuxPaths, Win32Paths } from '../../src/utils/paths';
import * as childProcess from '../../src/utils/childProcess';

type pathsClassType = typeof DarwinPaths|typeof LinuxPaths|typeof Win32Paths;

/**
 * Create empty default settings to bypass gracefully
 * FirstPage window.
 */
export function createDefaultSettings() {
  const pathInfo: Record<string, pathsClassType> = {
    darwin: DarwinPaths,
    linux:  LinuxPaths,
    win32:  Win32Paths,
  };

  createSettingsFile((new pathInfo[os.platform()]()).config);
}

function createSettingsFile(settingsPath: string) {
  const settingsData = {}; // empty array
  const settingsJson = JSON.stringify(settingsData);
  const fileSettingsName = 'settings.json';
  const settingsFullPath = path.join(settingsPath, '/', fileSettingsName);

  try {
    if (!fs.existsSync(settingsFullPath)) {
      fs.mkdirSync(settingsPath, { recursive: true });
      fs.writeFileSync(path.join(settingsPath, '/', fileSettingsName), settingsJson);
      console.log('Default settings file successfully created on: ', `${ settingsPath }/${ fileSettingsName }`);
    }
  } catch (err) {
    console.error('Error during default settings creation. Error: --> ', err);
  }
}

/**
 * Main function to select the tool based on platform.
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
