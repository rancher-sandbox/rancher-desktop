class IntegrationManager {

  enforce() {
    this.ensureIntegrationDir(true);
    this.ensureIntegrationSymlinks(true);
    this.ensureDockerCliSymlinks(true);
  }

  remove() {
    this.ensureDockerCliSymlinks(false);
    this.ensureIntegrationSymlinks(false);
    this.ensureIntegrationDir(false);
  }

  protected async ensureIntegrationDir(desiredPresent: boolean): Promise<void> {
    console.log(desiredPresent);
  }

  protected async ensureIntegrationSymlinks(desiredPresent: boolean): Promise<void> {
    console.log(desiredPresent);
  }

  protected async ensureDockerCliSymlinks(desiredPresent: boolean): Promise<void> {
    console.log(desiredPresent);
  }
}
