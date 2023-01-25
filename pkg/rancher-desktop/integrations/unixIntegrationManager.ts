import fs from 'fs';
import os from 'os';
import path from 'path';

import { IntegrationManager } from '@pkg/integrations/integrationManager';

/**
 * Manages integrations for Unix-like operating systems. Integrations take
 * the form of symlinks from the Rancher Desktop installation to two separate
 * directories: the "integrations directory", which should be in the user's path
 * somehow, and the "docker CLI plugins directory", which is the directory that
 * docker looks in for CLI plugins.
 * @param resourcesDir The directory in which UnixIntegrationManager expects to find
 *                     all integrations.
 * @param integrationDir The directory that symlinks are placed in.
 * @param dockerCliPluginDir The directory that docker CLI plugin symlinks are placed in.
 */
export default class UnixIntegrationManager implements IntegrationManager {
  protected resourcesDir: string;
  protected integrationDir: string;
  protected dockerCliPluginDir: string;

  constructor(resourcesDir: string, integrationDir: string, dockerCliPluginDir: string) {
    this.resourcesDir = resourcesDir;
    this.integrationDir = integrationDir;
    this.dockerCliPluginDir = dockerCliPluginDir;
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

  // gets the names of the integrations that we want to symlink into the
  // docker CLI plugin directory. They should all be of the form "docker-*".
  async getDockerCliPluginNames(): Promise<string[]> {
    return (await fs.promises.readdir(this.resourcesDir)).filter((name) => {
      return name.startsWith('docker-') && !name.startsWith('docker-credential-');
    });
  }

  protected async ensureIntegrationDir(desiredPresent: boolean): Promise<void> {
    if (desiredPresent) {
      await fs.promises.mkdir(this.integrationDir, { recursive: true, mode: 0o755 });
    } else {
      await fs.promises.rm(this.integrationDir, { force: true, recursive: true });
    }
  }

  protected async ensureIntegrationSymlinks(desiredPresent: boolean): Promise<void> {
    const validIntegrationNames = await fs.promises.readdir(this.resourcesDir);
    let currentIntegrationNames: string[] = [];

    // integration directory may or may not be present; handle error if not
    try {
      currentIntegrationNames = await fs.promises.readdir(this.integrationDir);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    // remove current integrations that are not valid
    await Promise.all(currentIntegrationNames.map(async(name) => {
      if (!validIntegrationNames.includes(name)) {
        await fs.promises.rm(path.join(this.integrationDir, name), { force: true });
      }
    }));

    // create or remove the integrations
    for (const name of validIntegrationNames) {
      const resourcesPath = path.join(this.resourcesDir, name);
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
    const rancherDesktopPath = path.join(this.integrationDir, 'rancher-desktop');
    const appImagePath = process.env['APPIMAGE'];

    if (desiredPresent && appImagePath) {
      await ensureSymlink(appImagePath, rancherDesktopPath);
    } else {
      await fs.promises.rm(rancherDesktopPath, { force: true });
    }
  }

  protected async ensureDockerCliSymlinks(desiredPresent: boolean): Promise<void> {
    // ensure the docker plugin path exists
    await fs.promises.mkdir(this.dockerCliPluginDir, { recursive: true, mode: 0o755 });

    // get a list of docker plugins
    const pluginNames = await this.getDockerCliPluginNames();

    // create or remove the plugin links
    for (const name of pluginNames) {
      const integrationPath = path.join(this.integrationDir, name);
      const dockerCliPluginPath = path.join(this.dockerCliPluginDir, name);

      if (!await this.weOwnDockerCliFile(dockerCliPluginPath)) {
        continue;
      }

      if (desiredPresent) {
        await ensureSymlink(integrationPath, dockerCliPluginPath);
      } else {
        await fs.promises.rm(dockerCliPluginPath, { force: true });
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
        return true;
      } else if (error.code === 'EINVAL') {
        // not a symlink
        return false;
      }
      throw error;
    }

    try {
      await fs.promises.stat(linkedTo);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // symlink is dangling
        return true;
      }
    }

    if (path.dirname(linkedTo).endsWith(this.integrationDir)) {
      return true;
    }

    if (path.dirname(linkedTo).endsWith(path.join('resources', os.platform(), 'bin'))) {
      return true;
    }

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
    await fs.promises.unlink(dstPath);
    await fs.promises.symlink(srcPath, dstPath);
  }
}
