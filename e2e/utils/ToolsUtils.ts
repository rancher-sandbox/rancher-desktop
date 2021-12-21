import os from 'os';
import path from 'path';
import * as childProcess from '../../src/utils/childProcess';

/**
 * Tool main function to select the tool based on platform
 * @param tool
 * @param args
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
 * kubectl tool
 * e.g.: await kubectl('version');
 * @param args
 * @returns tool output
 */
export async function kubectl(...args: string[] ): Promise<string> {
  return await tool('kubectl', ...args);
}
