import fs from 'fs';
import os from 'os';
import path from 'path';

// Manages integrations, which include standalone binaries such as
// kubectl and helm, as well as docker CLI plugins such as docker-compose
// and docker-buildx. Integrations take the form of symlinks from
// the Rancher Desktop installation to two separate directories:
// the "integrations directory", which should be in the user's path somehow,
// and the "docker CLI plugins directory", which is the directory that
// docker looks in for CLI plugins.
// @param resourcesDir The directory in which UnixIntegrationManager expects to find
//                     all integrations.
// @param integrationDir The directory that symlinks are placed in.
// @param dockerCliPluginDir The directory that docker CLI plugin symlinks are placed in.
export default class UnixIntegrationManager {
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
      return name.startsWith('docker-');
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
    // get list of integrations in the resources directory
    const integrationNames = await fs.promises.readdir(this.resourcesDir);

    // create or remove the integrations
    for (const name of integrationNames) {
      const installationPath = path.join(this.resourcesDir, name);
      const realizedPath = path.join(this.integrationDir, name);

      await manageSymlink(installationPath, realizedPath, desiredPresent);
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

      await manageSymlink(integrationPath, dockerCliPluginPath, desiredPresent, this.integrationDir);
    }
  }
}

// Ensures a symlink is either present or not present, while only changing it if
// the target path of any existing symlink matches a search string. Idempotent.
// @param srcPath The target path of the symlink.
// @param dstPath The path of the symlink.
// @param desiredPresent true to ensure the symlink is present; false to ensure it is not.
// @param searchString The string that the existing symlink's target path must match
//                     if changes are to be made to it. Default: resources/<platform>/bin
export async function manageSymlink(srcPath: string, dstPath: string, desiredPresent: boolean, searchString?: string): Promise<void> {
  let linkedTo: string;

  searchString = searchString ?? path.join('resources', os.platform(), 'bin');

  if (desiredPresent) {
    try {
      linkedTo = await fs.promises.readlink(dstPath);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        await fs.promises.symlink(srcPath, dstPath);

        return;
      } else if (error.code === 'EINVAL') {
        // dstPath is not a symlink, which means we don't own it
        return;
      }
      throw error;
    }

    // do nothing if we don't own the symlink
    if (!path.dirname(linkedTo).endsWith(searchString)) {
      return;
    }

    // fix the symlink if target is wrong
    if (linkedTo !== srcPath) {
      await fs.promises.unlink(dstPath);
      await fs.promises.symlink(srcPath, dstPath);
    }
  } else {
    try {
      linkedTo = await fs.promises.readlink(dstPath);
    } catch (error: any) {
      if (error.code === 'ENOENT' || error.code === 'EINVAL') {
        return;
      }
      throw error;
    }

    // do nothing if we don't own the symlink
    if (!path.dirname(linkedTo).endsWith(searchString)) {
      return;
    }

    await fs.promises.unlink(dstPath);
  }
}
