import path from 'path';
import fs from 'fs';
import os from 'os';

import Logging from '@/utils/logging';
import paths from '@/utils/paths';
import resources from '@/resources';
import PathConflictManager from '@/main/pathConflictManager';
import * as window from '@/window';
import { isNodeError } from '@/typings/unix.interface';

const INTEGRATIONS = ['docker', 'helm', 'kubectl', 'nerdctl'];
const console = Logging.background;
const PUBLIC_LINK_DIR = paths.integration;
const DOCKER_CLI_PLUGIN_DIR = path.join(os.homedir(), '.docker', 'cli-plugins');

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
    this.setupBinWatcher().catch((err) => {
      console.error('Error setting up bin-watcher:', err);
    });
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
      if (name === 'docker') {
        // See function jsdoc for what the integration is updated in `listIntegrations` and not `setIntegration`
        await this.setDockerPluginIntegration('docker-compose', this.#results[linkPath] === true);
        await this.setDockerPluginIntegration('docker-buildx', this.#results[linkPath] === true);
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
      }
    }

    return this.#results[linkPath] as string;
  }

  /**
   * This function is a combination of listIntegrations (to determine state) and setIntegration
   * (to carry out an action)
   * because docker plugins aren't independent, but depend on `docker`.
   * This is also why the function is called from listIntegrations and not setIntegration --
   * note that listIntegrations is always called after setIntegrations to show updated state
   * @param basename - the basename of the plugin to manage
   * @param state - activate integration if true
   * @protected
   */
  protected async setDockerPluginIntegration(basename: string, state: boolean): Promise<void> {
    const linkPath = path.join(DOCKER_CLI_PLUGIN_DIR, basename);
    const desiredPath = resources.executable(basename);

    try {
      const currentDest = await fs.promises.readlink(linkPath);

      if (currentDest === desiredPath && !state) {
        try {
          await fs.promises.unlink(linkPath);
        } catch (err) {
          console.error(`Error unlinking symlink for ${ linkPath }`, err);
        }
      } // otherwise either we have a link elsewhere -- leave it alone, or we want to keep the current link
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && state) {
        await this.createDockerComposeLink(desiredPath, linkPath, true);
      } // otherwise we don't care about why readlink failed.
    }
  }

  protected async createDockerComposeLink(desiredPath: string, linkPath: string, allowRetries: boolean) {
    try {
      await fs.promises.symlink(desiredPath, linkPath);
    } catch (err: any) {
      const message = `Error creating symlink for ${ linkPath }:`;

      if (err.code === 'ENOENT' && allowRetries) {
        try {
          // create the directory and retry
          await fs.promises.mkdir(DOCKER_CLI_PLUGIN_DIR, { recursive: true });
          await this.createDockerComposeLink(desiredPath, linkPath, false);
        } catch (err2) {
          console.error(`${ message }: error trying to create ${ DOCKER_CLI_PLUGIN_DIR }:`, err2);
        }

        return;
      }
      console.error(message, err);
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
