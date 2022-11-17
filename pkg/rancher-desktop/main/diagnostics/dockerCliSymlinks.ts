import fs from 'fs';
import os from 'os';
import path from 'path';

import { DiagnosticsCategory, DiagnosticsChecker } from './types';

import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';

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
    const displayableStartingPath = replaceHome(startingPath);
    const rdBinPath = path.join(paths.integration, this.name);
    const displayableRDBinPath = replaceHome(rdBinPath);
    const finalTarget = path.join(paths.resources, os.platform(), 'bin', this.name);
    const displayableFinalTarget = replaceHome(finalTarget);
    let state;
    let description = `The file \`${ displayableStartingPath }\``;
    let finalDescription = '';

    try {
      const link = await this.readlink(startingPath);

      console.debug(`${ this.id }: first-level symlink ${ displayableStartingPath }: points to: ${ link } (expect ${ displayableRDBinPath })`);

      if (link !== rdBinPath) {
        return {
          description: `${ description } should be a symlink to \`${ displayableRDBinPath }\`, but points to \`${ replaceHome(link) }\`.`,
          passed:      false,
          fixes:       [], // TODO: [{ description: `ln -sf ${ displayableRDBinPath } ${ displayableStartingPath }` }],
        };
      }
    } catch (ex: any) {
      const code = ex.code ?? '';

      if (code === 'ENOENT') {
        state = 'does not exist';
      } else if (code === 'EINVAL') {
        state = 'is not a symlink';
      } else {
        state = 'cannot be read';
      }

      return {
        description: `${ description } ${ state }. It should be a symlink to \`${ displayableRDBinPath }\`.`,
        passed:      false,
        fixes:       [],
      };
    }

    description = `The file \`${ displayableRDBinPath }\``;
    try {
      const link = await this.readlink(rdBinPath);

      if (link !== finalTarget) {
        return {
          description: `${ description } should be a symlink to \`${ displayableFinalTarget }\`, but points to \`${ replaceHome(link) }\`.`,
          passed:      false,
          fixes:       [],
        };
      }
      await this.access(link, fs.constants.X_OK);

      return {
        description: `\`${ displayableStartingPath }\` is a symlink to \`${ displayableFinalTarget }\` through \`${ displayableRDBinPath }\`.`,
        passed:      true,
        fixes:       [],
      };
    } catch (ex: any) {
      const code = ex.code ?? '';

      if (code === 'ENOENT') {
        finalDescription = `${ description } is a symlink to \`${ displayableFinalTarget }\`, which does not exist.`;
      } else if (code === 'EINVAL') {
        state = `is not a symlink`;
      } else if (code === 'ELOOP') {
        state = `is a symlink with a loop`;
      } else if (code === 'EACCES') {
        finalDescription = `${ description } is a symlink to \`${ displayableFinalTarget }\`, which is not executable.`;
      } else {
        finalDescription = `${ description } is a symlink to \`${ displayableFinalTarget }\`, but cannot be read (${ code || 'unknown error' }).`;
      }

      return {
        description: finalDescription || `${ description } ${ state }. It should be a symlink to \`${ displayableFinalTarget }\`.`,
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
