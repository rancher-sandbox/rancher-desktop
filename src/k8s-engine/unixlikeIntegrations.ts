import path from 'path';
import fs from 'fs';

import Logging from '@/utils/logging';
import paths from '@/utils/paths';
import resources from '@/resources';
import PathConflictManager from '@/main/pathConflictManager';
import * as window from '@/window';
import { isNodeError } from '@/typings/unix.interface';

const INTEGRATIONS = ['docker', 'helm', 'kubectl', 'nerdctl'];
const console = Logging.background;
const PUBLIC_LINK_DIR = paths.integration;

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

  /*
   * We want to watch ${PUBLIC_LINK_DIR} for changes, but fs.watch won't watch it until it exists.
   * Once there's a watcher on it, the directory can be deleted, and when it's recreated the
   * original watcher will still work on it.
   */
  #binWatcher: fs.FSWatcher|null = null;

  constructor() {
    this.setupBinWatcher();
  }

  async listIntegrations(): Promise<Record<string, boolean | string>> {
    for (const name of INTEGRATIONS) {
      const linkPath = path.join(PUBLIC_LINK_DIR, name);
      const desiredPath = resources.executable(name);

      try {
        const currentDest = await fs.promises.readlink(linkPath);

        if (currentDest === desiredPath) {
          this.#results[linkPath] = true;
        } else {
          this.#results[linkPath] = `Already linked to ${ currentDest }`;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          this.#results[linkPath] = false;
        } else if ((error as NodeJS.ErrnoException).code === 'EINVAL') {
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
        await fs.promises.symlink(desiredPath, linkPath);
      } catch (err) {
        const message = `Error creating symlink for ${ linkPath }:`;

        console.error(message, err);
        if (err instanceof Error) {
          this.#results[linkPath] = `${ message } ${ err.message }`;
        }

        return this.#results[linkPath] as string;
      }
    } else {
      try {
        await fs.promises.unlink(linkPath);
      } catch (err) {
        const message = `Error unlinking symlink for ${ linkPath }`;

        console.error(message, err);
        if (err instanceof Error) {
          this.#results[linkPath] = `${ message } ${ err.message }`;
        }

        return this.#results[linkPath] as string;
      }
    }
  }

  listIntegrationWarnings(): void {
    for (const name of INTEGRATIONS) {
      this.pathConflictManager.reportConflicts(name);
    }
  }

  protected async testUsrLocalBin() {
    try {
      await fs.promises.access(PUBLIC_LINK_DIR, fs.constants.W_OK | fs.constants.X_OK);
      this.#results[PUBLIC_LINK_DIR] = '';
      if (!this.#binWatcher) {
        this.#binWatcher = fs.watch(PUBLIC_LINK_DIR, async(eventType, filename) => {
          if (INTEGRATIONS.includes(filename)) {
            window.send('k8s-integrations', await this.listIntegrations());
          }
        });
      }
    } catch (error) {
      // if (error typeof NodeJS.ErrnoException) {
      if (!(isNodeError(error))) {
        return;
      }
      switch (error.code) {
      case 'ENOENT':
        this.#results[PUBLIC_LINK_DIR] = `Directory ${ PUBLIC_LINK_DIR } doesn't exist`;
        break;
      case 'EACCES':
        this.#results[PUBLIC_LINK_DIR] = `Insufficient permission to manipulate  ${ PUBLIC_LINK_DIR }: ${ error }`;
        break;
      default:
        this.#results[PUBLIC_LINK_DIR] = `Can't work with directory  ${ PUBLIC_LINK_DIR }: ${ error }'`;
      }
    }
  }

  protected async setupBinWatcher() {
    const { dir, base } = path.parse(PUBLIC_LINK_DIR);

    await this.testUsrLocalBin();
    fs.watch(dir, async(eventType, filename) => {
      if (filename === base) {
        await this.testUsrLocalBin();
        window.send('k8s-integrations', this.#results);
      }
    });
  }
}
