import fs from 'fs';
import os from 'os';
import path from 'path';

export default class UnixIntegrationManager {
  protected resourcesDir: string;
  protected integrationDir: string;
  protected dockerCliPluginDir: string;

  constructor(resourcesDir: string, integrationDir: string, dockerCliPluginDir: string) {
    this.resourcesDir = resourcesDir;
    this.integrationDir = integrationDir;
    this.dockerCliPluginDir = dockerCliPluginDir;
  }

  async enforce() {
    await this.ensureIntegrationDir(true);
    await this.ensureIntegrationSymlinks(true);
    await this.ensureDockerCliSymlinks(true);
  }

  async remove() {
    await this.ensureDockerCliSymlinks(false);
    await this.ensureIntegrationSymlinks(false);
    await this.ensureIntegrationDir(false);
  }

  async removeSymlinksOnly() {
    await this.ensureDockerCliSymlinks(false);
    await this.ensureIntegrationSymlinks(false);
  }

  async getIntegrationNames(): Promise<string[]> {
    return (await fs.promises.readdir(this.resourcesDir)).filter((name) => {
      return !['steve', 'trivy'].includes(name);
    });
  }

  // should be in form docker-*
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
    const integrationNames = await this.getIntegrationNames();

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
        return;
      }
      throw error;
    }

    // do nothing if we don't own the symlink
    if (!linkedTo.includes(searchString)) {
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
    if (!linkedTo.includes(searchString)) {
      return;
    }

    await fs.promises.unlink(dstPath);
  }
}
