import path from 'path';

import { AlpineLimaISOVersion, Dependency, DownloadContext } from 'scripts/lib/dependencies';
import { simpleSpawn } from 'scripts/simple_process';

/**
 * SudoPrompt represents the sudo-prompt.app applet used by sudo-prompt on macOS.
 */
export class SudoPrompt implements Dependency {
  name = 'sudo-prompt';

  async download(_: DownloadContext): Promise<void> {
    // Rather than actually downloading anything, this builds the source code.
    const sourceDir = path.join(process.cwd(), 'src', 'sudo-prompt');

    console.log(`Building sudo-prompt applet`);
    await simpleSpawn('./build-sudo-prompt', [], { cwd: sourceDir });
  }

  getAvailableVersions(_includePrerelease?: boolean | undefined): Promise<string[]> {
    throw new Error('sudo-prompt dependencies do not have available versions.');
  }

  rcompareVersions(_version1: string | AlpineLimaISOVersion, _version2: string): 0 | 1 | -1 {
    throw new Error('sudo-prompt dependencies do not have available versions.');
  }
}
