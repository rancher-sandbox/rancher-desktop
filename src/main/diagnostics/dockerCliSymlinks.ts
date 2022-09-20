import fs from 'fs';
import os from 'os';
import path from 'path';

import Logging from '@/utils/logging';
import paths from '@/utils/paths';

import type { DiagnosticsCategory, DiagnosticsChecker } from './diagnostics';

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

  readonly category = 'Utilities' as DiagnosticsCategory;
  applicable() {
    return Promise.resolve(['darwin', 'linux'].includes(os.platform()));
  }

  trigger?: ((checker: DiagnosticsChecker) => void) | undefined;

  // For testing use
  readonly readlink = fs.promises.readlink;
  readonly access = fs.promises.access;

  async check() {
    const rdBinPath = path.join(paths.integration, this.name);
    const dockerCliPluginDir = path.join(os.homedir(), '.docker', 'cli-plugins');
    let passed = false;
    let state;

    try {
      let link = await this.readlink(path.join(dockerCliPluginDir, this.name));

      console.debug(`docker-cli symlink: ${ this.name }: first-level symlink: ${ link } (expect ${ rdBinPath })`);
      if (link === rdBinPath) {
        while (true) {
          try {
            link = await this.readlink(link);
          } catch (ex) {
            break;
          }
        }
        console.debug(`docker-cli symlink: ${ this.name }: final symlink: ${ link } (app dir ${ paths.resources })`);
        if (path.relative(paths.resources, link).startsWith('.')) {
          state = `is a symlink to ${ replaceHome(link) }, which is not from Rancher Desktop`;
        } else {
          try {
            await this.access(link, fs.constants.X_OK);
            state = `is a symlink to ~/.rd/${ this.name }`;
            passed = true;
          } catch (ex) {
            const code = (ex as any).code ?? '';

            if (code === 'ENOENT') {
              state = `is a symlink to ${ replaceHome(link) }, which does not exist`;
            } else if (code === 'ELOOP') {
              state = `is a symlink with a loop`;
            } else if (code === 'EACCES') {
              state = `is a symlink to ${ replaceHome(link) }, which is not executable`;
            } else {
              state = `is a symlink to ${ replaceHome(link) }, but we could not read it (${ code })`;
            }
          }
        }
      } else {
        state = `is a symlink to ${ replaceHome(link) }`;
      }
    } catch (ex) {
      const code = (ex as any).code ?? '';

      console.debug(`docker-cli symlink: ${ this.name } got exception ${ code }: ${ ex }`);
      if (code === 'ENOENT') {
        state = `does not exist`;
      } else if (code === 'EINVAL') {
        state = `is not a symlink`;
      } else {
        state = `cannot be read`;
      }
    }
    let description = `The file ~/.docker/cli-plugins/${ this.name } ${ state }.`;

    if (!passed) {
      description += `  It should be a symlink to ~/.rd/bin/${ this.name }.`;
    }

    return {
      documentation: 'path#rd_bin_symlinks',
      description,
      passed,
      fixes:         [],
    };
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
