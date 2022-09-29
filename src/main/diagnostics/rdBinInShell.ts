import os from 'os';
import path from 'path';

import which from 'which';

import { DiagnosticsCategory, DiagnosticsChecker, DiagnosticsCheckerResult } from './types';

import { PathManagementStrategy } from '@/integrations/pathManager';
import mainEvents from '@/main/mainEvents';
import { spawnFile } from '@/utils/childProcess';
import Logging from '@/utils/logging';
import paths from '@/utils/paths';

const console = Logging.diagnostics;
const pathOutputDelimiter = 'Rancher Desktop Diagnostics PATH:';
let pathStrategy = PathManagementStrategy.NotSet;

mainEvents.on('settings-update', (cfg) => {
  pathStrategy = cfg.pathManagementStrategy;
});

export class RDBinInShellPath implements DiagnosticsChecker {
  constructor(id: string, executable: string, ...args: string[]) {
    this.id = id;
    console.log('ID', this.id);
    if (['darwin', 'linux'].includes(os.platform())) {
      this.executable = which.sync(executable, { nothrow: true }) ?? '';
      console.log('EXECUTABLE', this.executable);
    }
    this.args = args.concat(`printf "\n${ pathOutputDelimiter }%s\n" "$PATH"`);
    console.log('ARGS', this.args);
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
      const { stdout } = await spawnFile(this.executable, this.args, { stdio: ['ignore', 'pipe', 'pipe'] });

      console.log('STDOUT', { stdout });
      const dirs = stdout.split('\n')
        .filter(line => line.startsWith(pathOutputDelimiter))
        .pop()?.split(':')
        .map(RDBinInShellPath.removeTrailingSlash) ?? [];

      console.log('DIRS', { dirs });
      const integrationPath = RDBinInShellPath.removeTrailingSlash(paths.integration);

      console.log('INTEGRATION PATH', { integrationPath });
      const desiredDirs = dirs.filter(p => p === integrationPath);

      console.log('DESIRED DIRS', { desiredDirs });
      const exe = path.basename(this.executable);

      passed = desiredDirs.length > 0;
      console.log('PASSED', { passed });
      description = `The ~/.rd/bin directory has not been added to the PATH, so command-line utilities are not configured in your ${ exe } shell.`;
      if (passed) {
        console.log('PASSED', { passed });
        description = `The ~/.rd/bin directory is found in your PATH as seen from ${ exe }.`;
      } else if (pathStrategy !== PathManagementStrategy.RcFiles) {
        console.log('NOT PASSED', { passed });
        const description = `You have selected manual PATH configuration;
            consider letting Rancher Desktop automatically configure it.`;

        fixes.push({ description: description.replace(/\s+/gm, ' ') });
      }
    } catch (ex: any) {
      console.log('ERROR', { ex });
      console.error(`path diagnostics for ${ this.executable }: error: `, ex);
      description = ex.message ?? ex.toString();
      passed = false;
    }

    return {
      description,
      passed,
      fixes,
    };
  }

  static removeTrailingSlash(s: string): string {
    return s.replace(/(.)\/*$/, '$1');
  }
}

// Use `bash -l` because `bash -i` causes RD to suspend
const RDBinInBash = new RDBinInShellPath('RD_BIN_IN_BASH_PATH', 'bash', '-l', '-c');
const RDBinInZsh = new RDBinInShellPath('RD_BIN_IN_ZSH_PATH', 'zsh', '-i', '-c');

export default [RDBinInBash, RDBinInZsh] as DiagnosticsChecker[];
