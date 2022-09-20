import fs from 'fs';
import os from 'os';
import path from 'path';

import { DiagnosticsCategory, DiagnosticsChecker } from './types';

import { PathManagementStrategy } from '@/integrations/pathManager';
import mainEvents from '@/main/mainEvents';
import { spawnFile } from '@/utils/childProcess';
import paths from '@/utils/paths';

let pathStrategy = PathManagementStrategy.NotSet;

mainEvents.on('settings-update', (cfg) => {
  pathStrategy = cfg.pathManagementStrategy;
});

class RDBinInShellPath implements DiagnosticsChecker {
  constructor(id: string, executable: string, ...args: string[]) {
    this.id = id;
    this.executable = executable;
    this.args = args;
  }

  id: string;
  executable: string;
  args: string[];
  category = DiagnosticsCategory.Utilities;
  async applicable(): Promise<boolean> {
    if (!['darwin', 'linux'].includes(os.platform())) {
      return false;
    }
    try {
      await fs.promises.access(this.executable, fs.constants.X_OK);

      return true;
    } catch (ex) {
      return false;
    }
  }

  async check() {
    const { stdout } = await spawnFile(this.executable, this.args, { stdio: 'pipe' });
    const dirs = stdout.trim().split(':');
    const desiredDirs = dirs.filter(p => p === paths.integration);
    const passed = desiredDirs.length > 0;
    const fixes: {description: string}[] = [];
    const exe = path.basename(this.executable);
    let description = `The ~/.rd/bin directory has not been added to the PATH, so command-line utilities are not configured in your ${ exe } shell.`;

    if (passed) {
      description = `The ~/.rd/bin directory is found in your PATH as seen from ${ exe }.`;
    } else if (pathStrategy !== PathManagementStrategy.RcFiles) {
      const description = `You have selected manual PATH configuration;
          consider letting Rancher Desktop automatically configure it.`;

      fixes.push({ description: description.replace(/\s+/gm, ' ') });
    }

    return {
      documentation: `path#${ this.id.toLowerCase() }`,
      description,
      passed,
      fixes,
    };
  }
}

const RDBinInBash = new RDBinInShellPath('RD_BIN_IN_BASH_PATH', '/bin/bash', '-l', '-c', 'echo $PATH');
const RDBinInZsh = new RDBinInShellPath('RD_BIN_IN_ZSH_PATH', '/bin/zsh', '--rcs', '-c', 'echo $PATH');

export default [RDBinInBash, RDBinInZsh] as DiagnosticsChecker[];
