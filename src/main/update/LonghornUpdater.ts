import { MacUpdater, NsisUpdater, AppImageUpdater } from 'electron-updater';
import { Lazy } from 'lazy-val';

import LonghornProvider, { GithubReleaseAsset, LonghornProviderOptions } from './LonghornProvider';

export class NsisLonghornUpdater extends NsisUpdater {
  protected configOnDisk = new Lazy<LonghornProviderOptions>(() => this['loadUpdateConfig']());

  get hasUpdateConfiguration(): Promise<boolean> {
    return (async() => {
      const config = await this.configOnDisk.value;

      return !!config.upgradeServer;
    })();
  }

  protected async getUpdateInfoAndProvider() {
    if (this['clientPromise'] === null) {
      const config = await this.configOnDisk.value;

      this['clientPromise'] = new LonghornProvider(config, this, this['createProviderRuntimeOptions']());
    }

    return await super.getUpdateInfoAndProvider();
  }

  findAsset(assets: GithubReleaseAsset[]): GithubReleaseAsset | undefined {
    return assets.find(asset => asset.name.endsWith('.exe'));
  }
}

export class MacLonghornUpdater extends MacUpdater {
  protected configOnDisk = new Lazy<LonghornProviderOptions>(() => this['loadUpdateConfig']());

  get hasUpdateConfiguration(): Promise<boolean> {
    return (async() => {
      const config = await this.configOnDisk.value;

      return !!config.upgradeServer;
    })();
  }

  protected async getUpdateInfoAndProvider() {
    if (this['clientPromise'] === null) {
      const config = await this.configOnDisk.value;

      this['clientPromise'] = new LonghornProvider(config, this, this['createProviderRuntimeOptions']());
    }

    return await super.getUpdateInfoAndProvider();
  }

  findAsset(assets: GithubReleaseAsset[]): GithubReleaseAsset | undefined {
    return assets.find(asset => asset.name.endsWith('-mac.zip'));
  }
}

export class LinuxLonghornUpdater extends AppImageUpdater {
  protected configOnDisk = new Lazy<LonghornProviderOptions>(() => this['loadUpdateConfig']());

  get hasUpdateConfiguration(): Promise<boolean> {
    return (async() => {
      const config = await this.configOnDisk.value;

      return !!config.upgradeServer;
    })();
  }

  protected async getUpdateInfoAndProvider() {
    if (this['clientPromise'] === null) {
      const config = await this.configOnDisk.value;

      this['clientPromise'] = new LonghornProvider(config, this, this['createProviderRuntimeOptions']());
    }

    return await super.getUpdateInfoAndProvider();
  }

  findAsset(assets: GithubReleaseAsset[]): GithubReleaseAsset | undefined {
    return assets.find(asset => asset.name.endsWith('AppImage'));
  }
}
