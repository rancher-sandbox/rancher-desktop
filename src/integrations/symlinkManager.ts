import fs from 'fs';
import paths from '@/utils/paths';

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
    console.log(desiredPresent);
  }

  protected async ensureDockerCliSymlinks(desiredPresent: boolean): Promise<void> {
    console.log(desiredPresent);
  }
}
