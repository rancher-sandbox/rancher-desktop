import path from 'path';
import fs from 'fs';

import { Console } from 'console';
import Logging from '@/utils/logging';
import resources from '@/resources';
import PathConflictManager from '@/main/pathConflictManager';
import * as window from '@/window';

const Integrations = [ 'helm', 'kim', 'kubectl', 'nerdctl' ];
const console = new Console(Logging.background.stream);

/*
 * There are probably going to be only two kinds of integrations: WSL for Windows,
 * and everything else for macos and linux, should it be supported. For now, this class
 * is currently intended to be used for various VM strategies for macOS.
 */
export default class UnixlikeIntegrations {
  #results: Record<string, boolean | string> = {}
  /*
   * Used to supply integration-warnings
   */
  protected pathConflictManager = new PathConflictManager();

  constructor() {
    this.setupBinWatcher();
  }

  async testUsrLocalBin() {
    try {
      await fs.promises.access('/usr/local/bin', fs.constants.W_OK | fs.constants.X_OK);
      this.#results['/usr/local/bin'] = '';
    } catch (error) {
      switch (error.code) {
      case 'ENOENT':
        this.#results['/usr/local/bin'] = "Directory /usr/local/bin doesn't exist";
        break;
      case 'EACCES':
        this.#results['/usr/local/bin'] = `Insufficient permission to manipulate /usr/local/bin: ${ error }`;
        break;
      default:
        this.#results['/usr/local/bin'] = `Can't work with directory /usr/local/bin: ${ error }'`;
      }
    }
  }

  async setupBinWatcher() {
    await this.testUsrLocalBin();
    fs.watch('/usr/local', async(eventType, filename) => {
      if (filename === 'bin') {
        await this.testUsrLocalBin();
        window.send('k8s-integrations', this.#results);
      }
    });
  }

  async listIntegrations(): Promise<Record<string, boolean | string>> {
    for (const name of Integrations) {
      const linkPath = path.join('/usr/local/bin', name);
      const desiredPath = resources.executable(name);

      try {
        const currentDest = await fs.promises.readlink(linkPath);

        if (currentDest === desiredPath) {
          this.#results[linkPath] = true;
        } else {
          this.#results[linkPath] = `Already linked to ${ currentDest }`;
        }
      } catch (error) {
        if (error.code === 'ENOENT') {
          this.#results[linkPath] = false;
        } else if (error.code === 'EINVAL') {
          this.#results[linkPath] = `File exists and is not a symbolic link`;
        } else {
          this.#results[linkPath] = `Can't link to ${ linkPath }: ${ error }`;
        }
      }
    }

    return this.#results;
  }

  async setIntegration(linkPath: string, state: boolean): Promise<string | undefined> {
    const desiredPath = resources.executable(path.basename(linkPath));

    this.#results[linkPath] = '';
    if (state) {
      try {
        await fs.promises.symlink(desiredPath, linkPath, 'file');
      } catch (err) {
        const message = `Error creating symlink for ${ linkPath }:`;

        console.error(message, err);
        this.#results[linkPath] = `${ message } ${ err.message }`;

        return this.#results[linkPath] as string;
      }
    } else {
      try {
        await fs.promises.unlink(linkPath);
      } catch (err) {
        const message = `Error unlinking symlink for ${ linkPath }`;

        console.error(message, err);
        this.#results[linkPath] = `${ message } ${ err.message }`;

        return this.#results[linkPath] as string;
      }
    }
  }

  listIntegrationWarnings(): void {
    for (const name of Integrations) {
      this.pathConflictManager.reportConflicts(name);
    }
  }
}
