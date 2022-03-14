import fs from 'fs';
import os from 'os';
import path from 'path';
import paths from '@/utils/paths';
import resources from '@/resources';

class IntegrationManager {
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

  protected async ensureIntegrationDir(desiredPresent: boolean): Promise<void> {
    if (desiredPresent) {
      await fs.promises.mkdir(this.integrationDir);
    } else {
      await fs.promises.rmdir(this.integrationDir);
    }
  }

  protected async ensureIntegrationSymlinks(desiredPresent: boolean): Promise<void> {
    // get list of integrations in the resources directory
    const integrationNames = (await fs.promises.readdir(this.resourcesDir)).filter((name) => {
      return !['steve', 'trivy'].includes(name);
    });

    // create or remove the integrations
    integrationNames.forEach(async(name: string) => {
      const realizedPath = path.join(this.integrationDir, name);
      if (desiredPresent) {
        await fs.promises.symlink(resources.executable(name), realizedPath);
      } else {
        await fs.promises.rm(realizedPath, {force: true});
      }
    });
  }

  protected async ensureDockerCliSymlinks(desiredPresent: boolean): Promise<void> {
    // get a list of docker plugins (should be in form docker-*)
    const pluginNames = (await fs.promises.readdir(this.resourcesDir)).filter((name) => {
      return name.startsWith('docker-');
    });

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

//const resourcesDir = path.join(process.resourcesPath, 'resources');
//const dockerCliPluginDir = path.join(os.homedir(), '.docker', 'cli-plugins');
