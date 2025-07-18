import fs from 'fs';
import os from 'os';
import path from 'path';

import { IntegrationManager } from '@pkg/integrations/integrationManager';
import Logging from '@pkg/utils/logging';

interface UnixIntegrationManagerOptions {
  /** Directory containing tools shipped with Rancher Desktop. */
  binDir:                string;
  /** Directory to place tools the user can use. */
  integrationDir:        string;
  /** Directory containing docker CLI plugins shipped with Rancher Desktop. */
  dockerCLIPluginSource: string;
  /** Directory to place docker CLI plugins for with the docker CLI. */
  dockerCLIPluginDest:   string;
}

const console = Logging.integrations;

/**
 * Manages integrations for Unix-like operating systems. Integrations take
 * the form of symlinks from the Rancher Desktop installation to two separate
 * directories: the "integrations directory", which should be in the user's path
 * somehow, and the "docker CLI plugins directory", which is the directory that
 * docker looks in for CLI plugins.
 */
export default class UnixIntegrationManager implements IntegrationManager {
  protected binDir:                string;
  protected integrationDir:        string;
  protected dockerCLIPluginSource: string;
  protected dockerCLIPluginDest:   string;

  constructor(options: UnixIntegrationManagerOptions) {
    this.binDir = options.binDir;
    this.integrationDir = options.integrationDir;
    this.dockerCLIPluginSource = options.dockerCLIPluginSource;
    this.dockerCLIPluginDest = options.dockerCLIPluginDest;
  }

  // Idempotently installs directories and symlinks onto the system.
  async enforce(): Promise<void> {
    await this.ensureIntegrationDir(true);
    await this.ensureIntegrationSymlinks(true);
    await this.ensureDockerCliSymlinks(true);
  }

  // Idempotently removes any trace of managed directories and symlinks from
  // the system.
  async remove(): Promise<void> {
    await this.ensureDockerCliSymlinks(false);
    await this.ensureIntegrationSymlinks(false);
    await this.ensureIntegrationDir(false);
  }

  // Idempotently removes any symlinks from the system. Does not remove
  // directories. Intended for AppImages, where any symlinks to the installation
  // are invalidated each time the application exits (the application directory
  // is a filesystem image that is mounted in /tmp for each run).
  async removeSymlinksOnly(): Promise<void> {
    await this.ensureDockerCliSymlinks(false);
    await this.ensureIntegrationSymlinks(false);
  }

  protected async ensureIntegrationDir(desiredPresent: boolean): Promise<void> {
    if (desiredPresent) {
      await fs.promises.mkdir(this.integrationDir, { recursive: true, mode: 0o755 });
    } else {
      await fs.promises.rm(this.integrationDir, { force: true, recursive: true });
    }
  }

  /**
   * Set up the symbolic links in the integration directory.  This will include
   * both files from `binDir` as well as `dockerCLIPluginSource`; this is needed
   * in case users try to run `docker-compose` instead of `docker compose`.
   */
  protected async ensureIntegrationSymlinks(desiredPresent: boolean): Promise<void> {
    const RDIntegration = 'rancher-desktop';
    const sourceDirs = [this.binDir, this.dockerCLIPluginSource];
    const validIntegrations = Object.fromEntries((await Promise.all(sourceDirs.map(async(d) => {
      return (await fs.promises.readdir(d)).map(f => [f, d] as const);
    }))).flat(1));
    let currentIntegrationNames: string[] = [];

    // integration directory may or may not be present; handle error if not
    try {
      currentIntegrationNames = await fs.promises.readdir(this.integrationDir);
      currentIntegrationNames = currentIntegrationNames.filter(v => v !== RDIntegration);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    // remove current integrations that are not valid
    await Promise.all(currentIntegrationNames.map(async(name) => {
      if (!(name in validIntegrations)) {
        await fs.promises.rm(path.join(this.integrationDir, name), { force: true });
      }
    }));

    // create or remove the integrations
    for (const [name, dir] of Object.entries(validIntegrations)) {
      const resourcesPath = path.join(dir, name);
      const integrationPath = path.join(this.integrationDir, name);

      if (desiredPresent) {
        await ensureSymlink(resourcesPath, integrationPath);
      } else {
        await fs.promises.rm(integrationPath, { force: true });
      }
    }

    // manage the special rancher-desktop integration; this symlink
    // exists so that rdctl can find the path to the AppImage
    // that Rancher Desktop is running from
    const rancherDesktopPath = path.join(this.integrationDir, RDIntegration);
    const appImagePath = process.env['APPIMAGE'];

    if (desiredPresent && appImagePath) {
      await ensureSymlink(appImagePath, rancherDesktopPath);
    } else {
      await fs.promises.rm(rancherDesktopPath, { force: true });
    }
  }

  protected async ensureDockerCliSymlinks(desiredPresent: boolean): Promise<void> {
    // ensure the docker plugin path exists
    await fs.promises.mkdir(this.dockerCLIPluginDest, { recursive: true, mode: 0o755 });

    // get a list of docker plugins
    const pluginNames = await fs.promises.readdir(this.dockerCLIPluginSource);

    // create or remove the plugin links
    for (const name of pluginNames) {
      // We create symlinks to the integration directory instead of the file
      // directly, to avoid factory reset having to deal with it.
      const sourcePath = path.join(this.integrationDir, name);
      const destPath = path.join(this.dockerCLIPluginDest, name);

      if (!await this.weOwnDockerCliFile(destPath)) {
        console.debug(`Skipping ${ destPath } - we don't own it`);
        continue;
      }

      console.debug(`Will update ${ destPath }`);

      if (desiredPresent) {
        await ensureSymlink(sourcePath, destPath);
      } else {
        await fs.promises.rm(destPath, { force: true });
      }
    }
  }

  listIntegrations(): Promise<Record<string, boolean | string> | null> {
    return Promise.resolve(null);
  }

  // Tells the caller whether Rancher Desktop is allowed to modify/remove
  // a file in the docker CLI plugins directory.
  protected async weOwnDockerCliFile(filePath: string): Promise<boolean> {
    let linkedTo: string;

    try {
      linkedTo = await fs.promises.readlink(filePath);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // symlink doesn't exist, so create it
        console.debug(`Symlink ${ filePath } does not exist, will create.`);

        return true;
      } else if (error.code === 'EINVAL') {
        // not a symlink
        console.debug(`${ filePath } is not a symlink, will ignore.`);

        return false;
      }
      throw error;
    }

    try {
      await fs.promises.stat(linkedTo);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // symlink is dangling
        console.debug(`Symlink ${ filePath } links to dangling ${ linkedTo }, will replace.`);

        return true;
      }
    }

    if (path.dirname(linkedTo).endsWith(this.integrationDir)) {
      console.debug(`Symlink ${ filePath } links to ${ linkedTo } which is in ${ this.integrationDir }, will replace`);

      return true;
    }

    if (path.dirname(linkedTo).endsWith(path.join('resources', os.platform(), 'docker-cli-plugins'))) {
      console.debug(`Symlink ${ filePath } links to ${ linkedTo }, will replace`);

      return true;
    }

    console.debug(`Symlink ${ filePath } links to unknown path ${ linkedTo }, will ignore.`);

    return false;
  }
}

// Ensures that the file/symlink at dstPath
// a) is a symlink
// b) has a target path of srcPath
export async function ensureSymlink(srcPath: string, dstPath: string): Promise<void> {
  let linkedTo = '';

  try {
    linkedTo = await fs.promises.readlink(dstPath);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      // symlink doesn't exist, so create it
      await fs.promises.symlink(srcPath, dstPath);

      return;
    } else if (error.code === 'EINVAL') {
      // not a symlink; remove and replace with symlink
      await fs.promises.rm(dstPath, { force: true });
      await fs.promises.symlink(srcPath, dstPath);

      return;
    }
    throw error;
  }

  if (linkedTo !== srcPath) {
    console.debug(`Replacing symlinks at ${ dstPath } from ${ linkedTo } to ${ srcPath }`);
    await fs.promises.unlink(dstPath);
    await fs.promises.symlink(srcPath, dstPath);
  }
}
