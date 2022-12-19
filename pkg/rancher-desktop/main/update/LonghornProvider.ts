import fs from 'fs';
import os from 'os';
import path from 'path';
import { URL } from 'url';
import util from 'util';

import { newError, CustomPublishOptions } from 'builder-util-runtime';
import Electron from 'electron';
import { AppUpdater, Provider, ResolvedUpdateFileInfo, UpdateInfo } from 'electron-updater';
import { ProviderRuntimeOptions, ProviderPlatform } from 'electron-updater/out/providers/Provider';
import semver from 'semver';

import fetch from '@pkg/utils/fetch';
import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';

const console = Logging.update;
const gCachePath = path.join(paths.cache, 'updater-longhorn.json');

/**
 * If the upgrade responder doesn't have a requestIntervalInMinutes field (or if
 * it's zero), use this value instead.  Note that the server can still set it to
 * be less than this value.
 */
const defaultUpdateIntervalInMinutes = 60;

/**
 * LonghornProviderOptions specifies the options available for LonghornProvider.
 */
export interface LonghornProviderOptions extends CustomPublishOptions {
  /**
   * upgradeServer is the URL for the upgrade-responder server
   * @example "https://responder.example.com:8314/v1/checkupgrade"
   */
  readonly upgradeServer: string;

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

/** LonghornUpdateInfo is an UpdateInfo with additional fields for custom use. */
export interface LonghornUpdateInfo extends UpdateInfo {
  /**
   * The minimum time (milliseconds since Unix epoch) we should next check for
   * an update.
   */
  nextUpdateTime: number;
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

  tag_name: string;
  name: string;
  body: string;
  draft: boolean;
  prerelease: boolean;

  published_at: string;
  assets: GithubReleaseAsset[];
}

/**
 * LonghornCache contains the information we keep in the update cache file.
 * Note that this will only contain information relevant for the current
 * platform.
 */
interface LonghornCache {
  /** The minimum time (in Unix epoch) we should next check for an update. */
  nextUpdateTime: number;
  /** Whether the recorded release is an installable update */
  isInstallable: boolean;
  release: {
    /** Release tag, typically in the form "v1.2.3". */
    tag: string;
    /** The name of the release, typically the same as the tag. */
    name: string;
    /** Release notes, in GitHub-flavoured markdown. */
    notes: string;
    /** The release date of the next release. */
    date: string;
  },
  file: {
    /** URL to download the release. */
    url: string;
    /** File size of the release. */
    size: number;
    /** Checksum of the release. */
    checksum: string;
  }
}

export async function hasQueuedUpdate(): Promise<boolean> {
  try {
    const rawCache = await fs.promises.readFile(gCachePath, 'utf-8');
    const cache: LonghornCache = JSON.parse(rawCache);

    if (!cache.isInstallable) {
      return false;
    }

    // The isInstallable flag isn't going to get clear _right_ after an update;
    // in which case, we need to check that the release is newer than the
    // current version.
    const currentVersion = semver.parse(Electron.app.getVersion(), { loose: true });
    const stagedVersion = semver.parse(cache.release.tag, { loose: true });

    if (!currentVersion || !stagedVersion) {
      console.log(`Error parsing staged versions: ${ currentVersion ?? '<none>' } -> ${ stagedVersion ?? '<none>' }`);

      return false;
    }
    if (semver.gte(currentVersion, stagedVersion)) {
      console.log(`Staged version ${ stagedVersion } not greater than current version ${ currentVersion }, skipping.`);

      return false;
    }
    console.debug(`Performing update from ${ currentVersion } to ${ stagedVersion }...`);

    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('Could not check for queued update:', error);
    }
  }

  return false;
}

export async function setHasQueuedUpdate(isQueued: boolean): Promise<void> {
  try {
    const rawCache = await fs.promises.readFile(gCachePath, 'utf-8');
    const cache: LonghornCache = JSON.parse(rawCache);

    cache.isInstallable = isQueued;
    await fs.promises.writeFile(gCachePath, JSON.stringify(cache),
      { encoding: 'utf-8', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('Could not check for queued update:', error);
    }
  }
}

/**
 * LonghornProvider is a Provider that interacts with Longhorn's
 * [Upgrade Responder](https://github.com/longhorn/upgrade-responder) server to
 * locate upgrade versions.  It assumes that the versions are actually published
 * as GitHub releases.  It also assumes that all versions have assets for all
 * platforms (that is, it doesn't filter by platform on checking).
 *
 * Note that we do internal caching to avoid issues with being double-counted in
 * the stats.
 */
export default class LonghornProvider extends Provider<LonghornUpdateInfo> {
  constructor(
    private readonly configuration: CustomPublishOptions,
    private readonly updater: AppUpdater,
    runtimeOptions: ProviderRuntimeOptions,
  ) {
    super(runtimeOptions);
    this.platform = runtimeOptions.platform;
  }

  private readonly platform: ProviderPlatform;

  /**
   * Fetch a checksum file and return the checksum; expects only one file per
   * checksum file.
   * @param checksumURL The URL to the file containing the checksum.
   * @returns Base64-encoded checksum.
   */
  protected async getSha512Sum(checksumURL: string): Promise<string> {
    const contents = await (await fetch(checksumURL)).text();
    const buffer = Buffer.from(contents.split(/\s+/)[0], 'hex');

    return buffer.toString('base64');
  }

  /**
   * Check for updates, possibly returning the cached information if it is still
   * applicable.
   */
  protected async checkForUpdates(): Promise<LonghornCache> {
    try {
      const rawCache = await fs.promises.readFile(gCachePath, 'utf-8');
      const cache: LonghornCache = JSON.parse(rawCache);

      if (cache.nextUpdateTime > Date.now()) {
        return cache;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // Log the unexpected error, but keep going.
        console.error('Error reading update cache:', error);
      }
    }

    // Get the latest release from the upgrade responder.
    const requestPayload = {
      appVersion: this.updater.currentVersion.format(),
      extraInfo:  { platform: `${ os.platform() }-${ os.arch() }` },
    };
    // If we are using anything on `github.io` as the update server, we're
    // trying to run a simplified test.  In that case, break the protocol and do
    // a HTTP GET instead of the HTTP POST with data we should do for actual
    // longhorn upgrade-responder servers.
    const requestOptions = /^https?:\/\/[^/]+\.github\.io\//.test(this.configuration.upgradeServer) ? { method: 'GET' } : {
      method: 'POST',
      body:   JSON.stringify(requestPayload),
    };

    console.debug(`Checking for upgrades from ${ this.configuration.upgradeServer }`);
    const responseRaw = await fetch(this.configuration.upgradeServer, requestOptions);
    const response = await responseRaw.json() as LonghornUpgraderResponse;

    console.debug(`Upgrade server response:`, util.inspect(response, true, null));
    const latest = response.versions?.find(v => v.Tags.includes('latest'));
    const requestIntervalInMinutes = response.requestIntervalInMinutes || defaultUpdateIntervalInMinutes;
    const requestIntervalInMs = requestIntervalInMinutes * 1000 * 60;
    const nextRequestTime = Date.now() + requestIntervalInMs;

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
    const assetFilter: (asset: GithubReleaseAsset) => boolean = (() => {
      switch (this.platform) {
      case 'darwin': {
        const isArm64 = Electron.app.runningUnderARM64Translation || os.arch() === 'arm64';
        const suffix = isArm64 ? '-mac.aarch64.zip' : '-mac.x86_64.zip';

        return (asset: GithubReleaseAsset) => asset.name.endsWith(suffix);
      }
      case 'linux':
        return (asset: GithubReleaseAsset) => asset.name.endsWith('AppImage');
      case 'win32': {
        return (asset: GithubReleaseAsset) => asset.name.endsWith('.msi');
      }
      }
    })();
    const wantedAsset = releaseInfo.assets.find(assetFilter);

    if (!wantedAsset) {
      console.log(`Rejecting release ${ releaseInfo.name } - could not find usable asset.`);
      throw newError(
        `Could not find suitable assets in release ${ releaseInfo.name }`,
        'ERR_UPDATER_ASSET_NOT_FOUND',
      );
    }

    const checksumAsset = releaseInfo.assets.find(asset => asset.name === `${ wantedAsset.name }.sha512sum`);

    if (!checksumAsset) {
      console.log(`Rejecting release ${ releaseInfo.name } - could not find checksum for ${ wantedAsset.name }`);
      throw newError(
        `Could not find checksum for asset ${ wantedAsset.name }`,
        'ERR_UPDATER_ASSET_NOT_FOUND',
      );
    }

    const cache: LonghornCache = {
      nextUpdateTime: nextRequestTime,
      isInstallable:  false, // Always false, we'll update this later.
      release:        {
        tag,
        name:  releaseInfo.name,
        notes: releaseInfo.body,
        date:  releaseInfo.published_at,
      },
      file: {
        url:      wantedAsset.browser_download_url,
        size:     wantedAsset.size,
        checksum: await this.getSha512Sum(checksumAsset.browser_download_url),
      },
    };

    await fs.promises.writeFile(gCachePath, JSON.stringify(cache),
      { encoding: 'utf-8', mode: 0o600 });

    return cache;
  }

  async getLatestVersion(): Promise<LonghornUpdateInfo> {
    const cache = await this.checkForUpdates();

    return {
      files:   [{
        url:                   cache.file.url,
        size:                  cache.file.size,
        sha512:                cache.file.checksum,
        isAdminRightsRequired: false,
      }],
      version:        cache.release.tag,
      path:                     '',
      sha512:                   '',
      releaseName:    cache.release.name,
      releaseNotes:   cache.release.notes,
      releaseDate:    cache.release.date,
      nextUpdateTime: cache.nextUpdateTime,
    };
  }

  resolveFiles(updateInfo: UpdateInfo): ResolvedUpdateFileInfo[] {
    return updateInfo.files.map(file => ({
      url:  new URL(file.url),
      info: file,
    }));
  }
}
