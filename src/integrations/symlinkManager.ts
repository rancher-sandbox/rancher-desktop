import fs from 'fs';
import path from 'path';
import paths from '@/utils/paths';
import resources from '@/resources';

class IntegrationManager {

  async enforce() {
    await this.ensureIntegrationDir(true);
    this.ensureIntegrationSymlinks(true);
    this.ensureDockerCliSymlinks(true);
  }

  async remove() {
    await this.ensureDockerCliSymlinks(false);
    this.ensureIntegrationSymlinks(false);
    this.ensureIntegrationDir(false);
  }

  protected async ensureIntegrationDir(desiredPresent: boolean): Promise<void> {
    if (desiredPresent) {
      await fs.promises.mkdir(paths.integration);
    } else {
      await fs.promises.rmdir(paths.integration);
    }
  }

  protected async ensureIntegrationSymlinks(desiredPresent: boolean): Promise<void> {
    // get list of integrations in the resources directory
    const resourcesDir = path.join(process.resourcesPath, 'resources');
    const integrationNames = (await fs.promises.readdir(resourcesDir)).filter((name) => {
      return !['steve', 'trivy'].includes(name);
    });

    // create or remove the integrations
    integrationNames.forEach(async(name: string) => {
      const realizedPath = path.join(paths.integration, name);
      if (desiredPresent) {
        await fs.promises.symlink(resources.executable(name), realizedPath);
      } else {
        await fs.promises.rm(realizedPath, {force: true});
      }
    });
  }

  protected async ensureDockerCliSymlinks(desiredPresent: boolean): Promise<void> {
    console.log(desiredPresent);
  }
}
