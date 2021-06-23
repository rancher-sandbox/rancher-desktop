import { Console } from 'console';
import os from 'os';
import { URL } from 'url';

import { newError, PublishConfiguration } from 'builder-util-runtime';
import { AppUpdater, Provider, ResolvedUpdateFileInfo, UpdateInfo } from 'electron-updater';
import { ProviderRuntimeOptions } from 'electron-updater/out/providers/Provider';
import fetch from 'node-fetch';

import Logging from '@/utils/logging';

const console = new Console(Logging.update.stream);

export interface LonghornUpdateInfo extends UpdateInfo {
  /**
   * The number of minutes until the next update check should be triggered.
   */
  requestIntervalInMinutes: number;
}

export function isLonghornUpdateInfo(info: UpdateInfo): info is LonghornUpdateInfo {
  return 'requestIntervalInMinutes' in info;
}

/**
 * LonghornProviderOptions specifies the options available for LonghornProvider.
 */
export interface LonghornProviderOptions extends PublishConfiguration {
  /**
   * upgradeServer is the URL for the upgrade-responder server
   * @example "https://responder.example.com:8314/v1/checkupgrade"
   */
  readonly upgradeServer: URL;

  /**
   * The provider. Must be `custom`.
   */
  readonly provider: 'custom';

  /**
   * The GitHub owner / organization.  Should be detected during packaging.
   */
  readonly owner: string;

  /**
   * The GitHub repository name.  Should be detected during packaging.
   */
   readonly repo: string;

  /**
   * Whether to use `v`-prefixed tag name.
   * @default true
   */
  readonly vPrefixedTagName?: boolean
}

/**
 * LonghornUpgraderResponse describes the response from the Longhorn upgrade
 * responder service.
 */
interface LonghornUpgraderResponse {
  versions: {
    Name: string;
    ReleaseDate: Date;
    Tags: string[];
  }[];
  /**
   * The number of minutes before the next upgrade check should be performed.
   */
  requestIntervalInMinutes: number;
}

export interface GithubReleaseAsset {
  url: string;
  // eslint-disable-next-line camelcase
  browser_download_url: string;
  id: number;
  name: string;
  label: string;
  size: number;
}

/**
 * GithubReleaseInfo describes the API response from GitHub for fetching one
 * release.
 */
interface GithubReleaseInfo {
  url: string;
  id: number;
  // eslint-disable-next-line camelcase
  tag_name: string;
  name: string;
  body: string;
  draft: boolean;
  prerelease: boolean;
  // eslint-disable-next-line camelcase
  published_at: string;
  assets: GithubReleaseAsset[];
}

interface LonghornUpdater extends AppUpdater {
  findAsset(assets: GithubReleaseAsset[]): GithubReleaseAsset | undefined;
}

/**
 * LonghornProvider is a Provider that interacts with Longhorn's
 * [Upgrade Responder](https://github.com/longhorn/upgrade-responder) server to
 * locate upgrade versions.  It assumes that the versions are actually published
 * as GitHub releases.  It also assumes that all versions have assets for all
 * platforms (that is, it doesn't filter by platform on checking).
 */
export default class LonghornProvider extends Provider<LonghornUpdateInfo> {
  constructor(
    private readonly configuration: LonghornProviderOptions,
    private readonly updater: LonghornUpdater,
    runtimeOptions: ProviderRuntimeOptions
  ) {
    super(runtimeOptions);
  }

  /**
   * Fetch a checksum file and return the checksum; expects only one file per
   * checksum file.
   * @param checksumURL The URL to the file containing the checksum.
   * @returns Base64-encoded checksum.
   */
  async getSha512Sum(checksumURL: string): Promise<string> {
    const contents = await (await fetch(checksumURL)).text();
    const buffer = Buffer.from(contents.split(/\s+/)[0], 'hex');

    return buffer.toString('base64');
  }

  async getLatestVersion(): Promise<LonghornUpdateInfo> {
    // Get the latest release from the upgrade responder.
    const requestPayload = {
      appVersion: this.updater.currentVersion.format(),
      extraInfo:  { platform: `${ os.platform() }-${ os.arch() }` },
    };
    const responseRaw = await fetch(
      this.configuration.upgradeServer,
      { method: 'POST', body: JSON.stringify(requestPayload) });
    const response = await responseRaw.json() as LonghornUpgraderResponse;
    const latest = response.versions.find( v => v.Tags.includes('latest'));

    if (!latest) {
      throw newError('Could not find latest version', 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND');
    }

    // Get release information from GitHub releases.
    const { owner, repo, vPrefixedTagName } = this.configuration;
    const tag = (vPrefixedTagName ? 'v' : '') + latest.Name.replace(/^v/, '');
    const infoURL = `https://api.github.com/repos/${ owner }/${ repo }/releases/tags/${ tag }`;
    const releaseInfoRaw = await fetch(infoURL,
      { headers: { Accept: 'application/vnd.github.v3+json' } });
    const releaseInfo = await releaseInfoRaw.json() as GithubReleaseInfo;
    const wantedAsset = this.updater.findAsset(releaseInfo.assets);

    if (!wantedAsset) {
      console.log(`Rejecting release ${ releaseInfo.name } - could not find usable asset.`);
      throw newError(
        `Could not find suitable assets in release ${ releaseInfo.name }`,
        'ERR_UPDATER_ASSET_NOT_FOUND'
      );
    }

    const checksumAsset = releaseInfo.assets.find(asset => asset.name === `${ wantedAsset.name }.sha512sum`);

    if (!checksumAsset) {
      console.log(`Rejecting release ${ releaseInfo.name } - could not find checksum for ${ wantedAsset.name }`);
      throw newError(
        `Could not find checksum for asset ${ wantedAsset.name }`,
        'ERR_UPDATER_ASSET_NOT_FOUND'
      );
    }

    return {
      files:   [{
        url:    wantedAsset.browser_download_url,
        size:   wantedAsset.size,
        sha512: await this.getSha512Sum(checksumAsset.browser_download_url),
      }],
      version:                  tag,
      path:                     '',
      sha512:                   '',
      releaseName:              releaseInfo.name,
      releaseNotes:             releaseInfo.body,
      releaseDate:              releaseInfo.published_at,
      requestIntervalInMinutes: response.requestIntervalInMinutes,
    };
  }

  resolveFiles(updateInfo: UpdateInfo): ResolvedUpdateFileInfo[] {
    return updateInfo.files.map(file => ({
      url:  new URL(file.url),
      info: file,
    }));
  }
}
