import fs from 'fs';
import os from 'os';
import path from 'path';

export default class IntegrationManager {
  protected resourcesDir: string;
  protected integrationDir: string;
  protected dockerCliPluginDir: string;
  protected legacyIntegrationDir: string;

  constructor(resourcesDir: string, integrationDir: string, dockerCliPluginDir: string, legacyIntegrationDir: string) {
    this.resourcesDir = resourcesDir;
    this.integrationDir = integrationDir;
    this.dockerCliPluginDir = dockerCliPluginDir;
    this.legacyIntegrationDir = legacyIntegrationDir;
  }

  async enforce() {
    //await this.removeLegacySymlinks();
    await this.ensureIntegrationDir(true);
    await this.ensureIntegrationSymlinks(true);
    await this.ensureDockerCliSymlinks(true);
  }

  async remove() {
    //await this.removeLegacySymlinks();
    await this.ensureDockerCliSymlinks(false);
    await this.ensureIntegrationSymlinks(false);
    await this.ensureIntegrationDir(false);
  }

  async appImageRemove() {
    if (!process.env['APPIMAGE']) {
      throw new Error('appImageRemove() applies only when running as an AppImage');
    }
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
      await fs.promises.mkdir(this.integrationDir);
    } else {
      await fs.promises.rmdir(this.integrationDir);
    }
  }

  protected async ensureIntegrationSymlinks(desiredPresent: boolean): Promise<void> {
    // get list of integrations in the resources directory
    const integrationNames = await this.getIntegrationNames();

    // create or remove the integrations
    integrationNames.forEach(async(name: string) => {
      const installationPath = path.join(this.resourcesDir, name);
      const realizedPath = path.join(this.integrationDir, name);
      if (desiredPresent) {
        await fs.promises.symlink(installationPath, realizedPath);
      } else {
        await fs.promises.unlink(realizedPath);
      }
    });
  }

  protected async ensureDockerCliSymlinks(desiredPresent: boolean): Promise<void> {
    // ensure the docker plugin path exists
    await fs.promises.mkdir(this.dockerCliPluginDir, {recursive: true, mode: 0o755});

    // get a list of docker plugins
    const pluginNames = await this.getDockerCliPluginNames();

    // create or remove the plugin links
    pluginNames.forEach(async(name) => {
      const integrationPath = path.join(this.integrationDir, name);
      const dockerCliPluginPath = path.join(this.dockerCliPluginDir, name);
      if (desiredPresent) {
        await fs.promises.symlink(integrationPath, dockerCliPluginPath);
      } else {
        // FIXME
        await fs.promises.rm(dockerCliPluginPath, {force: true});
      }
    });
  }

  protected async removeLegacySymlinks(): Promise<void> {
    const integrationNames = await this.getIntegrationNames();

    integrationNames.forEach(async(name) => {
      const linkPath = path.join(this.legacyIntegrationDir, name);
      if (await this.isLegacyIntegration(linkPath)) {
        try {
          console.debug(`Attempting to remove legacy symlink ${ linkPath }`);
          await fs.promises.unlink(linkPath);
        } catch (error: any) {
          if (error.code !== 'ENOENT') {
            console.error(`Error unlinking symlink ${ linkPath }: ${ error.message }`);
          }
        }
      }
    });
  }

  // Tests whether a path is a legacy integration symlink that is safe to delete.
  // @param pathToCheck -- absolute path to the file that we want to check
  protected async isLegacyIntegration(pathToCheck: string): Promise<boolean> {
    let linkedTo: string;

    try {
      linkedTo = await fs.promises.readlink(pathToCheck);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.warn(`Error getting info about node ${ pathToCheck }: ${ error.message }`);
      }

      return false;
    }

    // We need to determine whether the symlink points to something that was
    // in a Rancher Desktop installation. Due to the range of possibilities
    // here, I think the best we can do is to match the symlink on the string
    // resources/<platform>/bin, since the location of the symlink can vary
    // across packaging formats and operating systems. This should be good enough
    // to keep it from matching symlinks that do not pertain to RD.
    const platform = os.platform();
    const searchString = path.join('resources', platform, 'bin');
    return linkedTo.includes(searchString);
  }
}
