import fs from 'fs';
import path from 'path';

export default class IntegrationManager {
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
}
