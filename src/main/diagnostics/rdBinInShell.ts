import os from 'os';
import path from 'path';

import which from 'which';

import { DiagnosticsCategory, DiagnosticsChecker, DiagnosticsCheckerResult } from './types';

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
    if (['darwin', 'linux'].includes(os.platform())) {
      this.executable = which.sync(executable, { nothrow: true }) ?? '';
    }
    this.args = args;
  }

  id: string;
  executable = '';
  args: string[];
  category = DiagnosticsCategory.Utilities;
  applicable(): Promise<boolean> {
    return Promise.resolve(!!this.executable);
  }

  async check(): Promise<DiagnosticsCheckerResult> {
    const fixes: {description: string}[] = [];
    let passed = false;
    let description: string;

    try {
      const { stdout } = await spawnFile(this.executable, this.args, { stdio: 'pipe' });
      const dirs = stdout.trim().split(/[:\n]/);
      const desiredDirs = dirs.filter(p => p === paths.integration);
      const exe = path.basename(this.executable);

      passed = desiredDirs.length > 0;
      description = `The ~/.rd/bin directory has not been added to the PATH, so command-line utilities are not configured in your ${ exe } shell.`;
      if (passed) {
        description = `The ~/.rd/bin directory is found in your PATH as seen from ${ exe }.`;
      } else if (pathStrategy !== PathManagementStrategy.RcFiles) {
        const description = `You have selected manual PATH configuration;
            consider letting Rancher Desktop automatically configure it.`;

        fixes.push({ description: description.replace(/\s+/gm, ' ') });
      }
    } catch (ex: any) {
      description = ex.message ?? ex.toString();
      passed = false;
    }

    return {
      description,
      passed,
      fixes,
    };
  }
}

const RDBinInBash = new RDBinInShellPath('RD_BIN_IN_BASH_PATH', 'bash', '-i', '-c', 'echo $PATH');
const RDBinInZsh = new RDBinInShellPath('RD_BIN_IN_ZSH_PATH', 'zsh', '-i', '-c', 'echo $PATH');

export default [RDBinInBash, RDBinInZsh] as DiagnosticsChecker[];
