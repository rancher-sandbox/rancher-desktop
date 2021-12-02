import os from 'os';
import Electron from 'electron';
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

  private readonly isArm64 = Electron.app.runningUnderRosettaTranslation || os.arch() === 'arm64';

  findAsset(assets: GithubReleaseAsset[]): GithubReleaseAsset | undefined {
    const suffix = this.isArm64 ? '-mac.aarch64.zip' : '-mac.x86_64.zip';

    return assets.find(asset => asset.name.endsWith(suffix));
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
