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
import { getMacOsVersion } from '@pkg/utils/osVersion';
import paths from '@pkg/utils/paths';
import getWSLVersion from '@pkg/utils/wslVersion';

const console = Logging.update;
const gCachePath = path.join(paths.cache, 'updater-longhorn.json');

/**
 * If Upgrade Responder doesn't have a requestIntervalInMinutes field (or if
 * it's zero), use this value instead.  Note that the server can still set it to
 * be less than this value.
 */
const defaultUpdateIntervalInMinutes = 60;

/**
 * LonghornProviderOptions specifies the options available for LonghornProvider.
 */
export interface LonghornProviderOptions extends CustomPublishOptions {
  /**
   * upgradeServer is the URL for the Upgrade Responder server
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
  nextUpdateTime:             number;
  /**
   * Whether there is an unsupported version of Rancher Desktop that is
   * newer than the latest supported version.
   */
  unsupportedUpdateAvailable: boolean;
}

/**
 * LonghornUpgraderResponse describes the response from the Longhorn Upgrade
 * Responder service.
 */
interface LonghornUpgraderResponse {
  versions:                 UpgradeResponderVersion[];
  /**
   * The number of minutes before the next update check should be performed.
   */
  requestIntervalInMinutes: number;
}

interface UpgradeResponderVersion {
  Name:        string;
  ReleaseDate: Date;
  Supported?:  boolean;
  Tags:        string[];
}

interface UpgradeResponderQueryResult {
  latest:                     UpgradeResponderVersion;
  requestIntervalInMinutes:   number,
  unsupportedUpdateAvailable: boolean,
}

export interface UpgradeResponderRequestPayload {
  appVersion: string;
  extraInfo: {
    platform:        string;
    platformVersion: string;
    wslVersion?:     string,
  },
}

export interface GitHubReleaseAsset {
  url: string;

  browser_download_url: string;
  id:                   number;
  name:                 string;
  label:                string;
  size:                 number;
}

/**
 * GitHubReleaseInfo describes the API response from GitHub for fetching one
 * release.
 */
interface GitHubReleaseInfo {
  url: string;
  id:  number;

  tag_name:   string;
  name:       string;
  body:       string;
  draft:      boolean;
  prerelease: boolean;

  published_at: string;
  assets:       GitHubReleaseAsset[];
}

/**
 * LonghornCache contains the information we keep in the update cache file.
 * Note that this will only contain information relevant for the current
 * platform.
 */
interface LonghornCache {
  /** The minimum time (in Unix epoch) we should next check for an update. */
  nextUpdateTime:             number;
  /**
   * Whether there is an unsupported version of Rancher Desktop that is
   * newer than the latest supported version.
   */
  unsupportedUpdateAvailable: boolean;
  /** Whether the recorded release is an installable update */
  isInstallable:              boolean;
  release: {
    /** Release tag, typically in the form "v1.2.3". */
    tag:   string;
    /** The name of the release, typically the same as the tag. */
    name:  string;
    /** Release notes, in GitHub-flavoured markdown. */
    notes: string;
    /** The release date of the next release. */
    date:  string;
  },
  file: {
    /** URL to download the release. */
    url:      string;
    /** File size of the release. */
    size:     number;
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
 * Return the OS version of whatever platform we are running on.
 * Note that this is *not* the kernel version; it is the OS version,
 * i.e. the version of the entire package, including kernel,
 * userspace programs, base configuration, etc.
 */
function getPlatformVersion(): string {
  switch (process.platform) {
  case 'win32':
    return os.release();
  case 'darwin': {
    return getMacOsVersion().toString();
  }
  case 'linux':
    // OS version is hard to get on Linux and could be in many different
    // formats. We hard-code it to 0.0.0 so that Upgrade Responder can
    // parse it into an InstanceInfo. Nevertheless, automatic updates
    // are not supported on Linux as of the time of writing, so this is
    // just in case we want to introduce rules for Linux that don't have
    // to do with platform version in the future.
    return '0.0.0';
  }
  throw new Error(`Platform "${ process.platform }" is not supported`);
}

/**
 * Get the installed WSL version as a string.  If the inbox version of WSL is
 * installed (rather than the store version), we just hard code "1.0.0" instead.
 * @note This function should never throw;
 */
export async function getWslVersionString(): Promise<string | undefined> {
  try {
    const { installed, inbox, version } = await getWSLVersion();

    if (!installed) {
      return;
    }
    if (inbox) {
      return '1.0.0';
    }

    return `${ version.major }.${ version.minor }.${ version.revision }.${ version.build }`;
  } catch (ex) {
    console.error('Failed to get WSL version:', ex);
  }
}

/**
 * Fetch info on available versions of Rancher Desktop, as well as other
 * things, from the Upgrade Responder server.
 */
export async function queryUpgradeResponder(url: string, currentVersion: semver.SemVer): Promise<UpgradeResponderQueryResult> {
  const requestPayload: UpgradeResponderRequestPayload = {
    appVersion: currentVersion.toString(),
    extraInfo:  {
      platform:        `${ process.platform }-${ os.arch() }`,
      platformVersion: getPlatformVersion(),
    },
  };

  if (process.platform === 'win32') {
    const wslVersion = await getWslVersionString();

    if (wslVersion) {
      requestPayload.extraInfo.wslVersion = wslVersion;
    }
  }

  // If we are using anything on `github.io` as the update server, we're
  // trying to run a simplified test.  In that case, break the protocol and do
  // a HTTP GET instead of the HTTP POST with data we should do for actual
  // Longhorn Upgrade Responder servers.
  const requestOptions = /^https?:\/\/[^/]+\.github\.io\//.test(url)
    ? { method: 'GET' }
    : {
      method: 'POST',
      body:   JSON.stringify(requestPayload),
    };

  console.debug(`Checking ${ url } for updates`);
  const responseRaw = await fetch(url, requestOptions);
  const response = await responseRaw.json() as LonghornUpgraderResponse;

  console.debug(`Upgrade Responder response:`, util.inspect(response, true, null));

  const allVersions = response.versions;

  // If Upgrade Responder does not send the Supported field,
  // assume that the version is supported.
  for (const version of allVersions) {
    version.Supported ??= true;
  }

  allVersions.sort((version1, version2) => semver.rcompare(version1.Name, version2.Name));
  const supportedVersions = allVersions.filter(version => version.Supported);

  if (supportedVersions.length === 0) {
    throw newError('Could not find latest version', 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND');
  }
  const latest = supportedVersions[0];
  const unsupportedUpdateAvailable = allVersions[0].Name !== latest.Name;

  return {
    latest,
    requestIntervalInMinutes: response.requestIntervalInMinutes,
    unsupportedUpdateAvailable,
  };
}

/**
 * LonghornProvider is a Provider that interacts with Longhorn's
 * [Upgrade Responder](https://github.com/longhorn/upgrade-responder) server to
 * determine which versions are available. It assumes that the versions are
 * published as GitHub releases. It also assumes that all versions have assets
 * for all platforms (that is, it doesn't filter by platform on checking).
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

    const queryResult = await queryUpgradeResponder(this.configuration.upgradeServer, this.updater.currentVersion);
    const { latest, unsupportedUpdateAvailable } = queryResult;
    const requestIntervalInMinutes = queryResult.requestIntervalInMinutes || defaultUpdateIntervalInMinutes;
    const requestIntervalInMs = requestIntervalInMinutes * 1000 * 60;
    const nextRequestTime = Date.now() + requestIntervalInMs;

    // Get release information from GitHub releases.
    const { owner, repo, vPrefixedTagName } = this.configuration;
    const tag = (vPrefixedTagName ? 'v' : '') + latest.Name.replace(/^v/, '');
    const infoURL = `https://api.github.com/repos/${ owner }/${ repo }/releases/tags/${ tag }`;
    const releaseInfoRaw = await fetch(infoURL,
      { headers: { Accept: 'application/vnd.github.v3+json' } });
    const releaseInfo = await releaseInfoRaw.json() as GitHubReleaseInfo;
    const assetFilter: (asset: GitHubReleaseAsset) => boolean = (() => {
      switch (this.platform) {
      case 'darwin': {
        const isArm64 = process.arch === 'arm64';
        const suffix = isArm64 ? '-mac.aarch64.zip' : '-mac.x86_64.zip';

        return (asset: GitHubReleaseAsset) => asset.name.endsWith(suffix);
      }
      case 'linux':
        return (asset: GitHubReleaseAsset) => asset.name.endsWith('AppImage');
      case 'win32': {
        return (asset: GitHubReleaseAsset) => asset.name.endsWith('.msi');
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
      unsupportedUpdateAvailable,
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
      files: [{
        url:                   cache.file.url,
        size:                  cache.file.size,
        sha512:                cache.file.checksum,
        isAdminRightsRequired: false,
      }],
      version:                    cache.release.tag,
      path:                       '',
      sha512:                     '',
      releaseName:                cache.release.name,
      releaseNotes:               cache.release.notes,
      releaseDate:                cache.release.date,
      nextUpdateTime:             cache.nextUpdateTime,
      unsupportedUpdateAvailable: cache.unsupportedUpdateAvailable,
    };
  }

  resolveFiles(updateInfo: UpdateInfo): ResolvedUpdateFileInfo[] {
    return updateInfo.files.map(file => ({
      url:  new URL(file.url),
      info: file,
    }));
  }
}
