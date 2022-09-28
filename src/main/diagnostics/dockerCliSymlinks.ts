import fs from 'fs';
import os from 'os';
import path from 'path';

import { DiagnosticsCategory, DiagnosticsChecker } from './types';

import Logging from '@/utils/logging';
import paths from '@/utils/paths';

const console = Logging.diagnostics;

/** Given a path, replace the user's home directory with "~". */
function replaceHome(input: string) {
  if (input.startsWith(os.homedir() + path.sep)) {
    return input.replace(os.homedir(), '~');
  }

  return input;
}

export class CheckerDockerCLISymlink implements DiagnosticsChecker {
  constructor(name: string) {
    this.name = name;
  }

  readonly name: string;
  get id() {
    return `RD_BIN_DOCKER_CLI_SYMLINK_${ this.name.toUpperCase() }`;
  }

  readonly category = DiagnosticsCategory.Utilities;
  applicable() {
    return Promise.resolve(['darwin', 'linux'].includes(os.platform()));
  }

  trigger?: ((checker: DiagnosticsChecker) => void) | undefined;

  // For testing use
  readonly readlink = fs.promises.readlink;
  readonly access = fs.promises.access;

  async check() {
    const dockerCliPluginDir = path.join(os.homedir(), '.docker', 'cli-plugins');
    const startingPath = path.join(dockerCliPluginDir, this.name);
    const rdBinPath = path.join(paths.integration, this.name);
    const finalTarget = path.join(paths.resources, os.platform(), 'bin', this.name);
    const finalDisplayableTarget = replaceHome(finalTarget);
    let state;
    let link = '';
    let description = `The file ${ startingPath }`;
    let finalDescription = '';

    try {
      link = await this.readlink(startingPath);

      console.debug(`docker-cli symlink: ${ this.name }: first-level symlink ${ startingPath }: points to: ${ link } (expect ${ rdBinPath })`);

      if (link !== rdBinPath) {
        return {
          description: `${ description } should be a symlink to ${ replaceHome(rdBinPath) }, but points to ${ link }.`,
          passed:      false,
          fixes:       [], // TODO: [{ description: `ln -sf ${ replaceHome(rdBinPath) } ${ replaceHome(startingPath) }` }],
        };
      }
    } catch (ex: any) {
      const code = (ex as any).code ?? '';

      if (code === 'ENOENT') {
        state = 'does not exist';
      } else if (code === 'EINVAL') {
        state = `is not a symlink`;
      } else {
        state = 'cannot be read';
      }

      return {
        description: `${ description } ${ state }. It should be a symlink to ${ replaceHome(rdBinPath) }.`,
        passed:      false,
        fixes:       [],
      };
    }

    description = `The file ${ rdBinPath }`;
    try {
      link = await this.readlink(link);
      if (link === finalTarget) {
        await this.access(link, fs.constants.X_OK);

        return {
          description: `${ startingPath } is a symlink to ${ finalDisplayableTarget } through ${ replaceHome(rdBinPath) }.`,
          passed:      true,
          fixes:       [],
        };
      } else {
        return {
          description: `${ description } should be a symlink to ${ finalDisplayableTarget }, but points to ${ replaceHome(link) }.`,
          passed:      false,
          fixes:       [],
        };
      }
    } catch (ex: any) {
      const code = (ex as any).code ?? '';

      if (code === 'ENOENT') {
        finalDescription = `${ description } is a symlink to ${ replaceHome(link) }, which does not exist.`;
      } else if (code === 'EINVAL') {
        state = `is not a symlink`;
      } else if (code === 'ELOOP') {
        state = `is a symlink with a loop`;
      } else if (code === 'EACCES') {
        finalDescription = `${ description } is a symlink to ${ replaceHome(link) }, which is not executable.`;
      } else {
        finalDescription = `${ description } is a symlink to ${ replaceHome(link) }, but cannot be read (${ code }).`;
      }

      return {
        description: finalDescription || `${ description } ${ state }. It should be a symlink to ${ finalDisplayableTarget }.`,
        passed:      false,
        fixes:       [],
      };
    }
  }
}

const dockerCliSymlinkCheckers: Promise<DiagnosticsChecker[]> = (async() => {
  const resourcesDir = path.join(paths.resources, os.platform(), 'bin');
  const allNames = await fs.promises.readdir(resourcesDir, 'utf-8');
  const names = allNames.filter(name => name.startsWith('docker-') && !name.startsWith('docker-credential-'));

  return names.map((name) => {
    return new CheckerDockerCLISymlink(name);
  });
})();

export default dockerCliSymlinkCheckers;
