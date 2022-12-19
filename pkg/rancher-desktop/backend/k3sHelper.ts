import crypto from 'crypto';
import events from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import stream from 'stream';
import tls from 'tls';
import util from 'util';

import { CustomObjectsApi, KubeConfig, V1ObjectMeta, findHomeDir } from '@kubernetes/client-node';
import { ActionOnInvalid } from '@kubernetes/client-node/dist/config_types';
import _ from 'lodash';
import { Response } from 'node-fetch';
import semver from 'semver';
import yaml from 'yaml';

import { Architecture, VMExecutor } from './backend';

import { KubeClient } from '@pkg/backend/client';
import * as K8s from '@pkg/backend/k8s';
import { loadFromString, exportConfig } from '@pkg/backend/kubeconfig';
import { checkConnectivity } from '@pkg/main/networking';
import { isUnixError } from '@pkg/typings/unix.interface';
import DownloadProgressListener from '@pkg/utils/DownloadProgressListener';
import * as childProcess from '@pkg/utils/childProcess';
import fetch from '@pkg/utils/fetch';
import Latch from '@pkg/utils/latch';
import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';
import { executable } from '@pkg/utils/resources';
import safeRename from '@pkg/utils/safeRename';
import { jsonStringifyWithWhiteSpace } from '@pkg/utils/stringify';
import { defined, RecursivePartial, RecursiveTypes } from '@pkg/utils/typeUtils';
import { showMessageBox } from '@pkg/window';

import type Electron from 'electron';

const console = Logging.k8s;

/**
 * ShortVersion is the version string without any k3s suffixes; this is the
 * version we present to the user.
 */
export type ShortVersion = string;

export interface ReleaseAPIEntry {

  tag_name: string;
  assets: {

    browser_download_url: string;
    name: string;
  }[];
}

export class NoCachedK3sVersionsError extends Error {
}

const CURRENT_CACHE_VERSION = 2 as const;

/** cacheData describes the JSON data we write to the cache. */
type cacheData = {
  cacheVersion?: typeof CURRENT_CACHE_VERSION;
  /** List of available versions; includes build information. */
  versions: string[];
  /** Mapping of channel labels to current version (excluding build information). */
  channels: Record<string, string>;
};

/**
 * RequiresRestartSeverityChecker is a function that will be used to determine
 * whether a given settings change will require a reset (i.e. deleting user
 * workloads).
 */
type RequiresRestartSeverityChecker<K extends keyof RecursiveTypes<K8s.BackendSettings>> =
  (currentValue: RecursiveTypes<K8s.BackendSettings>[K], desiredValue: RecursiveTypes<K8s.BackendSettings>[K]) => 'restart' | 'reset';

/**
 * RequiresRestartCheckers defines a mapping of settings (in dot-separated form)
 * to a RequiresRestartSeverityChecker for the given setting.
 */
type RequiresRestartCheckers = {
  [K in keyof RecursiveTypes<K8s.BackendSettings>]?: RequiresRestartSeverityChecker<K>;
};

/**
 * ExtraRequiresReasons defines a mapping of settings (in dot-separated form) to
 * the current value (that does not always match the stored settings) and a
 * RequiresRestartSeverityChecker for the given setting.
 */
export type ExtraRequiresReasons = {
  [K in keyof RecursiveTypes<K8s.BackendSettings>]?: {
    current: RecursiveTypes<K8s.BackendSettings>[K];
    severity?: RequiresRestartSeverityChecker<K>;
  }
};

/**
 * ChannelMapping is an internal structure to map a channel name to its
 * corresponding version.
 *
 * This only exists to aid in debugging.
 * This is only exported for tests.
 */
export class ChannelMapping {
  [channel: string]: semver.SemVer;
  [util.inspect.custom](depth: number, options: util.InspectOptionsStylized) {
    const entries = Object.entries(this).map(([channel, version]) => [channel, version.raw]);

    return util.inspect(Object.fromEntries(entries), { ...options, depth });
  }
}

/**
 * VersionEntry implements K8s.VersionEntry.
 *
 * This only exists to aid in debugging (by implementing util.debug.custom).
 * This is only exported for tests.
 */
export class VersionEntry implements K8s.VersionEntry {
  version: semver.SemVer;
  channels?: string[];

  constructor(version: semver.SemVer, channels: string[] = []) {
    this.version = version;
    if (channels?.length > 0) {
      this.channels = channels;
    }
  }

  [util.inspect.custom](depth: number, options: util.InspectOptionsStylized) {
    return util.inspect({
      ...this,
      version: this.version.raw,
    }, { ...options, depth });
  }
}

/**
 * Given a version, return the K3s build version.
 *
 * Note that this is only exported for testing.
 * @param version The version to parse
 * @returns The K3s build version
 */
export function buildVersion(version: semver.SemVer) {
  const [, numString] = /k3s(\d+)/.exec(version.build[0]) || [undefined, -1];

  return parseInt(`${ numString || '-1' }`);
}

export default class K3sHelper extends events.EventEmitter {
  protected readonly channelApiUrl = 'https://update.k3s.io/v1-release/channels';
  protected readonly channelApiAccept = 'application/json';
  protected readonly releaseApiUrl = 'https://api.github.com/repos/k3s-io/k3s/releases?per_page=100';
  protected readonly releaseApiAccept = 'application/vnd.github.v3+json';
  protected readonly cachePath = path.join(paths.cache, 'k3s-versions.json');
  protected readonly minimumVersion = new semver.SemVer('1.15.0');

  constructor(arch: Architecture) {
    super();
    this.arch = arch;
  }

  /**
   * Versions that we know to exist.  This is indexed by the version string,
   * without any build information (since we only ever take the latest build).
   * Note that the key is in the form `1.0.0` (i.e. without the `v` prefix).
   */
  protected versions: Record<ShortVersion, VersionEntry> = {};

  protected pendingNetworkSetup = Latch();
  protected pendingInitialize: Promise<void> | undefined;

  /** The current architecture. */
  protected readonly arch: Architecture;

  /**
   * Read the cached data and fill out this.versions.
   * The cache file consists of an array of VersionEntry.
   */
  protected async readCache() {
    try {
      const cacheData: cacheData =
        JSON.parse(await fs.promises.readFile(this.cachePath, 'utf-8'));

      if (cacheData.cacheVersion !== CURRENT_CACHE_VERSION) {
        // If the cache format version is different, ignore the cache.
        console.debug(`Ignoring cache with invalid version ${ cacheData.cacheVersion }`);

        return;
      }

      for (const versionString of cacheData.versions) {
        const version = semver.parse(versionString);

        if (version) {
          this.versions[version.version] = new VersionEntry(version);
        }
      }

      for (const [channel, version] of Object.entries(cacheData.channels)) {
        if (!this.versions[version]) {
          console.debug(`Ignoring invalid version cache: ${ channel } has invalid version ${ version }`);
          continue;
        }
        this.versions[version].channels ??= [];
        this.versions[version].channels?.push(channel);
      }

      for (const entry of Object.values(this.versions)) {
        entry.channels?.sort(this.compareChannels);
      }
    } catch (ex) {
      console.error(`Error reading cached version data, discarding:`, ex);
      // Clear any versions we may have, to be populated as if we had no cache.
      this.versions = {};
    }
  }

  /** Write this.versions into the cache file. */
  protected async writeCache() {
    const cacheData: cacheData = {
      cacheVersion: CURRENT_CACHE_VERSION,
      versions:     [],
      channels:     {},
    };

    if (!cacheData.versions || !cacheData.channels) {
      throw new Error('Panic: invalid code flow');
    }

    for (const [version, data] of Object.entries(this.versions)) {
      cacheData.versions.push(data.version.raw);
      for (const channel of data.channels ?? []) {
        cacheData.channels[channel] = version;
      }
    }
    cacheData.versions.sort((a, b) => semver.parse(a)?.compare(b) ?? a.localeCompare(b));
    const serializedCacheData = jsonStringifyWithWhiteSpace(cacheData);

    await fs.promises.mkdir(paths.cache, { recursive: true });
    await fs.promises.writeFile(this.cachePath, serializedCacheData, 'utf-8');
    console.debug(`Wrote versions cache:`, cacheData);
  }

  /** The files we need to download for the current architecture.
   *  images: an array of potential files in order of most preferred to least preferred
   */
  protected get filenames() {
    switch (this.arch) {
    case 'x86_64':
      return {
        exe:      'k3s',
        images:   ['k3s-airgap-images-amd64.tar.zst', 'k3s-airgap-images-amd64.tar'],
        checksum: 'sha256sum-amd64.txt',
      };
    case 'aarch64':
      return {
        exe:      'k3s-arm64',
        images:   ['k3s-airgap-images-arm64.tar.zst', 'k3s-airgap-images-arm64.tar'],
        checksum: 'sha256sum-arm64.txt',
      };
    }
  }

  /**
   * Process one version entry retrieved from GitHub, inserting it into the
   * cache.  This will not add any channel labels.
   * @param entry The GitHub API response entry to process.
   * @returns Whether more entries should be fetched.  Note that we will err on
   *          the side of getting more versions if we are unsure.
   */
  protected processVersion(entry: ReleaseAPIEntry): boolean {
    const version = semver.parse(entry.tag_name);

    if (!version) {
      console.log(`Skipping empty version ${ entry.tag_name }`);

      return true;
    }
    if (version.prerelease.length > 0) {
      // Skip any pre-releases.
      console.log(`Skipping pre-release ${ version.raw }`);

      return true;
    }
    if (version < this.minimumVersion) {
      console.log(`Version ${ version } is less than the minimum ${ this.minimumVersion }, skipping.`);

      // We may have new patch versions for really old releases; fetch more.
      return true;
    }
    if (!/^v?[0-9.]+(?:-rc\d+)?\+k3s\d+$/.test(version.raw)) {
      console.log(`Version ${ version.raw } looks like an erroneous version, skipping.`);

      return true;
    }
    const build = buildVersion(version);
    const oldVersion = this.versions[version.version];

    if (oldVersion) {
      const oldBuild = buildVersion(oldVersion.version);

      if (build < oldBuild) {
        console.log(`Skipping old version ${ version.raw }, have build ${ oldVersion.version.raw }`);

        // Since we read from newest first, we may end up with older builds of
        // some newer release, but still need to fetch the last build of an
        // older release.  So we still need to fetch more.
        return true;
      }
      if (build === oldBuild) {
        // If we see the _exact_ same version, we've found something we've
        // already seen before for sure.  This is the only situation where we
        // can be sure that we will not find more useful versions.
        console.log(`Found old version ${ version.raw }, stopping.`);
        console.debug(util.inspect({ version: version.raw, all: Object.keys(this.versions) }));

        return false;
      }
    }

    // Check that this release has all the assets we expect.
    if (entry.assets.find(ea => ea.name === this.filenames.exe) &&
        entry.assets.find(ea => ea.name === this.filenames.checksum)) {
      const foundImage = this.filenames.images.find(name => entry.assets.some(v => v.name === name));

      if (foundImage) {
        this.versions[version.version] = new VersionEntry(version);
        console.log(`Adding version ${ version.raw } - ${ foundImage }`);
      } else {
        console.debug(`Skipping version ${ version.raw } due to missing image`);
      }
    } else {
      console.debug(`Skipping version ${ version.raw } due to missing files`);
    }

    return true;
  }

  /**
   * Produce a promise that is resolved after a short delay, used for retrying
   * API requests when GitHub API requests are being rate-limited.
   */
  protected async delayForWaitLimiting(): Promise<void> {
    // This is a separate method so that we could override it in the tests.
    // Jest cannot override setTimeout: https://stackoverflow.com/q/52727220/
    await util.promisify(setTimeout)(1_000);
  }

  /**
   * Compare two channel names for sorting.
   */
  protected compareChannels(a: string, b: string) {
    // The names are either a word ("stable", "testing", etc.) or a branch
    // ("v1.2", etc.).  The sort should be words first, then branch.  For words,
    // list "stable" before anything else.  We assume no release can match two
    // branch channels at once.
    const versionRegex = /^v(?<major>\d+)\.(?<minor>\d+)/;

    if (a === 'stable' || b === 'stable') {
      // sort "stable" at the front
      return a === 'stable' ? -1 : 1;
    }
    if (versionRegex.test(a) || versionRegex.test(b)) {
      return versionRegex.test(a) ? 1 : -1;
    }

    return a.localeCompare(b);
  }

  protected async updateCache(): Promise<void> {
    try {
      let wantMoreVersions = true;
      let url = this.releaseApiUrl;
      const channelMapping = new ChannelMapping();

      await this.waitForNetwork();
      await this.readCache();
      console.log(`Updating release version cache with ${ Object.keys(this.versions).length } items in cache`);
      let channelResponse: Response;

      try {
        channelResponse = await fetch(this.channelApiUrl, { headers: { Accept: this.channelApiAccept } });
      } catch (ex: any) {
        console.log(`updateCache: error: ${ ex }`);
        if (!(await checkConnectivity('k3s.io'))) {
          return;
        }

        throw ex;
      }

      if (channelResponse.ok) {
        const channels = (await channelResponse.json()) as { data?: { name: string, latest: string }[] };

        // Remove any existing channels (to ensure channels we no longer use are removed)
        for (const version of Object.values(channelMapping)) {
          this.versions[version.version]?.channels?.splice(0, Number.POSITIVE_INFINITY);
        }
        console.debug(`Got K3s update channel data: ${ channels.data?.map(ch => ch.name) }`);
        for (const channel of channels.data ?? []) {
          const version = semver.parse(channel.latest);

          if (version) {
            channelMapping[channel.name] = version;
          }
        }
        console.debug('Recommended versions:', channelMapping);
      }

      while (wantMoreVersions && url) {
        const response = await fetch(url, { headers: { Accept: this.releaseApiAccept } });

        console.debug(`Fetching releases from ${ url } -> ${ response.statusText }`);
        if (!response.ok) {
          if (response.status === 403 && response.headers.get('X-RateLimit-Remaining') === '0') {
            // We hit the rate limit; try again after a delay.
            await this.delayForWaitLimiting();
            continue;
          }
          throw new Error(`Could not fetch releases: ${ response.statusText }`);
        }

        const linkHeader = response.headers.get('Link');

        if (linkHeader) {
          const [, nextURL] = /<([^>]+)>; rel="next"/.exec(linkHeader) || [];

          url = nextURL;
        } else {
          url = '';
        }

        wantMoreVersions = true;
        for (const entry of (await response.json()) as ReleaseAPIEntry[]) {
          if (!this.processVersion(entry)) {
            wantMoreVersions = false;
            break;
          }
        }
      }

      // Apply channel data
      for (const [channel, version] of Object.entries(channelMapping)) {
        const entry = this.versions[version.version];

        if (entry) {
          entry.channels ??= [];
          if (!entry.channels.includes(channel)) {
            entry.channels.push(channel);
            entry.channels.sort(this.compareChannels);
          }
        }
      }

      console.log(`Got ${ Object.keys(this.versions).length } versions.`);
      await this.writeCache();

      this.emit('versions-updated');
    } catch (e) {
      console.error(e);
      throw e;
    }
  }

  /**
   * Mark the network as ready; this is used as a barrier to ensure we do not
   * make network requests before setup is complete.
   */
  networkReady() {
    this.pendingNetworkSetup.resolve();
  }

  /**
   * This function waits for the `networkReady()` method to be called.
   */
  protected async waitForNetwork() {
    // `this.pendingNetworkSetup` is a Promise with an extra method that can be
    // used to resolve the promise.  By awaiting on it, we pause execution until
    // `this.networkReady()` is called (which resolves the promise).
    await this.pendingNetworkSetup;
  }

  /**
   * Initialize the version fetcher.
   * @returns A promise that is resolved when the initialization is complete.
   */
  initialize(): Promise<void> {
    if (!this.pendingInitialize) {
      this.pendingInitialize = (async() => {
        await this.readCache();
        if (Object.keys(this.versions).length > 0) {
          // Start a cache update asynchronously without waiting for it
          this.updateCache();

          return;
        }
        await this.updateCache();
      })();
    }

    return this.pendingInitialize;
  }

  /**
   * Return the version of k3s current installed, if available.
   */
  static async getInstalledK3sVersion(executor: VMExecutor): Promise<string | undefined> {
    let stdout: string;

    try {
      stdout = await executor.execCommand({ capture: true, expectFailure: true }, '/usr/local/bin/k3s', '--version');
    } catch (ex) {
      console.debug(`Failed to get k3s version: ${ ex } - assuming not installed.`);

      return undefined;
    }

    const line = stdout.split('/\r?\n/').find(line => /^k3s version /.test(line));

    if (!line) {
      console.debug(`K3s version not in --version output.`);

      return undefined;
    }

    const match = /^k3s version v?((?:\d+\.?)+\+k3s\d+)/.exec(line);

    if (!match) {
      console.debug(`Invalid k3s version line: ${ line.trim() }`);

      return undefined;
    }

    console.debug(`Got installed k3s version: ${ match[1] } (${ match[0] })`);

    return match[1];
  }

  /**
   * The versions that are available to install.
   */
  get availableVersions(): Promise<K8s.VersionEntry[]> {
    return (async() => {
      await this.initialize();
      const upstreamSeemsReachable = await checkConnectivity('k3s.io');
      const wrappedVersions = Object.values(this.versions);
      const finalOptions = upstreamSeemsReachable ? wrappedVersions : await K3sHelper.filterVersionsAgainstCache(wrappedVersions);

      return finalOptions.sort((a, b) => b.version.compare(a.version));
    })();
  }

  static async cachedVersionsOnly(): Promise<boolean> {
    return !(await checkConnectivity('k3s.io'));
  }

  static async filterVersionsAgainstCache(fullVersionList: K8s.VersionEntry[]): Promise<K8s.VersionEntry[]> {
    try {
      const cacheDir = path.join(paths.cache, 'k3s');
      const k3sFilenames = (await fs.promises.readdir(cacheDir))
        .filter(dirname => /^v\d+\.\d+\.\d+\+k3s\d+$/.test(dirname));
      const versionSet = new Set(k3sFilenames.map(filename => semver.parse(filename)?.version)
        .filter(defined));

      return fullVersionList.filter(versionEntry => versionSet.has(versionEntry.version.version));
    } catch (e: any) {
      if (e.code === 'ENOENT') {
        return [];
      }
      console.log('filterVersionsAgainstCache: Got exception:', e);
      throw e;
    }
  }

  /** The download URL prefix for K3s releases. */
  protected get downloadUrl() {
    return 'https://github.com/k3s-io/k3s/releases/download';
  }

  /**
   * Variable to keep track of download progress
   */
  progress = {
    exe:      { current: 0, max: 0 },
    images:   { current: 0, max: 0 },
    checksum: { current: 0, max: 0 },
  };

  /**
   * Find the cached version closest to the desired version.
   * @param desiredVersion The semver of the version of k3s the system would prefer to use,
   *                       with a '+k3s###' suffix
   * @returns A semver of the version to use, also with a '+k3s###' suffix
   */
  static async selectClosestImage(desiredVersion: semver.SemVer): Promise<semver.SemVer> {
    const cacheDir = path.join(paths.cache, 'k3s');
    const k3sFilenames = (await fs.promises.readdir(cacheDir))
      .filter(dirname => /^v\d+\.\d+\.\d+\+k3s\d+$/.test(dirname));

    return this.selectClosestSemVer(desiredVersion, k3sFilenames);
  }

  /**
   * Given a semver for the desired version, and a list of names representing other
   * k3s versions (matching /v\d+\.\d+\.\d+\+k3s\d+/), return the semver for the name
   * that is considered closest to the desired version:
   *
   * @precondition the desired version wasn't found
   * @param desiredVersion: a semver for the version currently specified in the config
   * @param k3sNames: typically a list of names like 'v1.2.3+k3s4'
   * @returns {semver.SemVer} the oldest version newer than the desired version
   *      If there is more than one such version, favor the one with the highest '+k3s' build version
   *      If there are none, the newest version older than the desired version
   * @throws {NoCachedK3sVersionsError} if no names are suitable
   */
  protected static selectClosestSemVer(desiredVersion: semver.SemVer, k3sNames: Array<string>): semver.SemVer {
    const existingVersions = k3sNames.map(filename => semver.parse(filename)).filter(defined);

    if (existingVersions.length === 0) {
      throw new NoCachedK3sVersionsError();
    }
    existingVersions.sort((v1, v2): number => {
      return v1.compare(v2) || this.compareBuildVersions(v1, v2);
    });
    const filteredVersions = this.keepHighestBuildVersion(existingVersions);
    const firstAcceptableVersion = filteredVersions.find(v => v.compare(desiredVersion) >= 0);

    return firstAcceptableVersion ?? filteredVersions[filteredVersions.length - 1];
  }

  // A comparator when the versions are the same so we need to compare the numeric part of the '+k3s...' parts
  protected static compareBuildVersions(v1: semver.SemVer, v2: semver.SemVer): number {
    return this.k3sValue(v1) - this.k3sValue(v2);
  }

  protected static k3sValue(v: semver.SemVer): number {
    try {
      return parseInt((v.build[0] as string).replace('k3s', ''), 10) || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Normally we should have only one build version in the cache for any MAJOR.MINOR.PATCH
   * But if we don't, ignore the lower build versions. This code is used to simplify the selection process
   * by removing the lower-build versions from consideration.
   * @precondition existingVersions is sorted such that `a[i].compare(a[i+1]) <= 0` for i in 0..a.length - 2
   * @param existingVersions {Array<semver.SemVer>} versions to choose from
   * @returns {Array<semver.SemVer>}: existingVersions,
   *          with lower-build versions culled out as described above.
   */
  protected static keepHighestBuildVersion(existingVersions: Array<semver.SemVer>): Array<semver.SemVer> {
    // Keep only the highest build for each version
    return existingVersions.filter((v, i) => {
      const next = existingVersions[i + 1];

      return next === undefined || v.compare(next) < 0;
    });
  }

  /**
  * Ensure that the K3s assets have been downloaded into the cache, which is
  * at (paths.cache())/k3s.
  * @param version The version of K3s to download, without the k3s suffix.
  */
  async ensureK3sImages(version: semver.SemVer): Promise<void> {
    const cacheDir = path.join(paths.cache, 'k3s');

    console.log(`Ensuring images available for K3s ${ version }`);
    const verifyChecksums = async(dir: string): Promise<Error | null> => {
      try {
        const sumFile = await fs.promises.readFile(path.join(dir, this.filenames.checksum), 'utf-8');
        const sums: Record<string, string> = {};

        for (const line of sumFile.split(/[\r\n]+/)) {
          const match = /^\s*([0-9a-f]+)\s+(.*)/i.exec(line.trim());

          if (!match) {
            continue;
          }
          const [, sum, filename] = match;

          sums[filename] = sum;
        }

        let existsIndex;

        for (let index = 0; typeof existsIndex === 'undefined' && index < this.filenames.images.length; index++) {
          try {
            await fs.promises.access(path.join(dir, this.filenames.images[index]), fs.constants.R_OK);
            existsIndex = index;
          } catch {
            // ignore access error and try next iteration if any
          }
        }
        if (typeof existsIndex === 'undefined') {
          existsIndex = 0;
        }
        const promises = [this.filenames.exe, this.filenames.images[existsIndex]].map(async(filename) => {
          const hash = crypto.createHash('sha256');

          await new Promise((resolve) => {
            hash.on('finish', resolve);
            fs.createReadStream(path.join(dir, filename)).pipe(hash);
          });

          const digest = hash.digest('hex');

          if (digest.localeCompare(sums[filename], undefined, { sensitivity: 'base' }) !== 0) {
            return new Error(`${ filename } has invalid digest ${ digest }, expected ${ sums[filename] }`);
          }

          return null;
        });

        return (await Promise.all(promises)).filter(x => x)[0];
      } catch (ex) {
        if ((ex as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw ex;
        }

        if (!(ex instanceof Error)) {
          return null;
        }

        return ex;
      }
    };

    await fs.promises.mkdir(cacheDir, { recursive: true });
    if (!await verifyChecksums(path.join(cacheDir, version.raw))) {
      console.log(`Cache at ${ cacheDir } is valid.`);

      return;
    }

    const workDir = await fs.promises.mkdtemp(path.join(cacheDir, `tmp-${ version.raw }-`));

    try {
      await Promise.all(Object.entries(this.filenames).map(async([filekey, filename]) => {
        const namearray = Array.isArray(filename) ? filename : [filename];

        let outPath;
        let response;

        for (const name of namearray) {
          const fileURL = `${ this.downloadUrl }/${ version.raw }/${ name }`;

          outPath = path.join(workDir, name);
          console.log(`Will attempt to download ${ filekey } ${ fileURL } to ${ outPath }`);
          response = await fetch(fileURL);
          if (response.ok) {
            break;
          }
        }

        if (!response || !outPath) {
          throw new Error(`Error downloading ${ filename } ${ version }: No ${ filekey }s found`);
        }

        const progresskey = filekey as keyof typeof K3sHelper.prototype.filenames;
        const status = this.progress[progresskey];

        status.current = 0;
        const progress = new DownloadProgressListener(status);
        const writeStream = fs.createWriteStream(outPath);

        status.max = parseInt(response.headers.get('Content-Length') || '0');
        await util.promisify(stream.pipeline)(response.body, progress, writeStream);
      }));

      const error = await verifyChecksums(workDir);

      if (error) {
        console.log('Error verifying checksums after download', error);
        throw error;
      }
      await safeRename(workDir, path.join(cacheDir, version.raw));
    } finally {
      await fs.promises.rm(workDir, {
        recursive: true, maxRetries: 3, force: true,
      });
    }
  }

  /**
   * Wait the K3s server to be ready after starting up.
   *
   * This will check that the proper TLS certificate is generated by K3s; this
   * is required as if the VM IP address changes, K3s will use a certificate
   * that is only valid for the old address for a short while.  If we attempt to
   * communicate with the cluster at this point, things will fail.
   *
   * @param getHost A function to return the IP address that K3s will listen on
   *                internally.  This may be called multiple times, as the
   *                address may not be ready yet.
   * @param port The port that K3s will listen on.
   */
  async waitForServerReady(getHost: () => Promise<string | undefined>, port: number): Promise<void> {
    let host: string | undefined;

    console.log(`Waiting for K3s server to be ready on port ${ port }...`);
    while (true) {
      try {
        host = await getHost();

        if (typeof host === 'undefined') {
          await util.promisify(setTimeout)(500);
          continue;
        }

        await new Promise<void>((resolve, reject) => {
          const socket = tls.connect(
            {
              host, port, rejectUnauthorized: false,
            },
            () => {
              const cert = socket.getPeerCertificate();

              // Check that the certificate contains a SubjectAltName that
              // includes the host we're looking for; when the server starts, it
              // may be using an obsolete certificate from a previous run that
              // doesn't include the current IP address.
              const names = cert.subjectaltname.split(',').map(s => s.trim());
              const acceptable = [`IP Address:${ host }`, `DNS:${ host }`];

              if (!names.some(name => acceptable.includes(name))) {
                return reject({ code: 'EAGAIN' });
              }

              // Check that the certificate is valid; if the IP address _didn't_
              // change, but the cert is old, we need to wait for it to be
              // regenerated.
              if (Date.parse(cert.valid_from).valueOf() >= Date.now()) {
                return reject({ code: 'EAGAIN' });
              }

              resolve();
            });

          socket.on('error', reject);
        });
        break;
      } catch (error) {
        if (!isUnixError(error)) {
          console.error(error);

          return;
        }

        switch (error.code) {
        case 'EAGAIN':
        case 'ECONNREFUSED':
        case 'ECONNRESET':
          break;
        default:
          // Unrecognized error; log but continue waiting.
          console.error(error);
        }
        await util.promisify(setTimeout)(1_000);
      }
    }
    console.log(`The K3s server is ready on ${ host }:${ port }.`);
  }

  /**
   * Find the kubeconfig file containing the given context; if none is found,
   * return the default kubeconfig path.
   * @param contextName The name of the context to look for
   */
  static async findKubeConfigToUpdate(contextName: string): Promise<string> {
    const candidatePaths = process.env.KUBECONFIG?.split(path.delimiter) || [];

    for (const kubeConfigPath of candidatePaths) {
      const config = new KubeConfig();

      try {
        config.loadFromFile(kubeConfigPath, { onInvalidEntry: ActionOnInvalid.FILTER });
        if (config.contexts.find(ctx => ctx.name === contextName)) {
          return kubeConfigPath;
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
      }
    }
    const home = findHomeDir();

    if (home) {
      const kubeDir = path.join(home, '.kube');

      await fs.promises.mkdir(kubeDir, { recursive: true });

      return path.join(kubeDir, 'config');
    }

    throw new Error(`Could not find a kubeconfig`);
  }

  /**
   * Update the user's kubeconfig such that the K3s context is available and
   * set as the current context.  This assumes that K3s is already running.
   *
   * @param configReader A function that returns the kubeconfig from the K3s VM.
   */
  async updateKubeconfig(configReader: () => Promise<string>): Promise<void> {
    const contextName = 'rancher-desktop';
    const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rancher-desktop-kubeconfig-'));

    try {
      const workPath = path.join(workDir, 'kubeconfig');

      // For some reason, using KubeConfig.loadFromFile presents permissions
      // errors; doing the same ourselves seems to work better.  Since the file
      // comes from the WSL container, it must not contain any paths, so there
      // is no need to fix it up.  This also lets us use an external function to
      // read the kubeconfig.
      const workConfig = new KubeConfig();
      const workContents = await configReader();

      workConfig.loadFromString(workContents);
      // @kubernetes/client-node doesn't have an API to modify the configs...
      const contextIndex = workConfig.contexts.findIndex(context => context.name === workConfig.currentContext);

      if (contextIndex >= 0) {
        const context = workConfig.contexts[contextIndex];
        const userIndex = workConfig.users.findIndex(user => user.name === context.user);
        const clusterIndex = workConfig.clusters.findIndex(cluster => cluster.name === context.cluster);

        if (userIndex >= 0) {
          workConfig.users[userIndex] = { ...workConfig.users[userIndex], name: contextName };
        }
        if (clusterIndex >= 0) {
          workConfig.clusters[clusterIndex] = { ...workConfig.clusters[clusterIndex], name: contextName };
        }
        workConfig.contexts[contextIndex] = {
          ...context, name: contextName, user: contextName, cluster: contextName,
        };

        workConfig.currentContext = contextName;
      }
      const userPath = await K3sHelper.findKubeConfigToUpdate(contextName);
      const userConfig = new KubeConfig();

      // @kubernetes/client-node throws when merging things that already exist
      const merge = <T extends { name: string }>(list: T[], additions: T[]) => {
        for (const addition of additions) {
          const index = list.findIndex(item => item.name === addition.name);

          if (index < 0) {
            list.push(addition);
          } else {
            list[index] = addition;
          }
        }
      };

      console.log(`Updating kubeconfig ${ userPath }...`);
      try {
        // Don't use loadFromFile() because it calls MakePathsAbsolute().
        // Use custom loadFromString() that supports the `proxy-url` cluster field.
        loadFromString(userConfig, fs.readFileSync(userPath, 'utf8'), { onInvalidEntry: ActionOnInvalid.FILTER });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.log(`Error trying to load kubernetes config file ${ userPath }:`, err);
        }
        // continue to merge into an empty userConfig == `{ contexts: [], clusters: [], users: [] }`
      }
      merge(userConfig.contexts, workConfig.contexts);
      merge(userConfig.users, workConfig.users);
      merge(userConfig.clusters, workConfig.clusters);
      userConfig.currentContext ??= contextName;
      // Use custom exportConfig() that supports the `proxy-url` cluster field.
      const userYAML = this.ensureContentsAreYAML(exportConfig(userConfig));
      const writeStream = fs.createWriteStream(workPath, { mode: 0o600 });

      await new Promise((resolve, reject) => {
        writeStream.on('error', reject);
        writeStream.on('finish', resolve);
        writeStream.end(userYAML, 'utf-8');
      });
      await safeRename(workPath, userPath);
    } finally {
      await fs.promises.rm(workDir, {
        recursive: true, force: true, maxRetries: 10,
      });
    }
  }

  /**
   * We normally parse all the config files, yaml and json, with yaml.parse, so yaml.parse
   * should work with json here.
   */
  protected ensureContentsAreYAML(contents: string): string {
    try {
      return yaml.stringify(yaml.parse(contents));
    } catch (err) {
      console.log(`Error in k3sHelper.ensureContentsAreYAML: ${ err }`);
    }

    return contents;
  }

  /**
   * Delete state related to Kubernetes.  This will ensure that images are not
   * deleted.
   * @param executor The interface to run commands in the VM.
   */
  async deleteKubeState(executor: VMExecutor) {
    const directories = [
      '/var/lib/kubelet', // https://github.com/kubernetes/kubernetes/pull/86689
      // We need to keep /var/lib/rancher/k3s/agent/containerd for the images.
      '/var/lib/rancher/k3s/data',
      '/var/lib/rancher/k3s/server',
      '/var/lib/rancher/k3s/storage',
      '/etc/rancher/k3s',
      '/run/k3s',
    ];

    console.log(`Attempting to remove K3s state: ${ directories.sort().join(' ') }`);
    await Promise.all(directories.map(d => executor.execCommand({ root: true }, 'rm', '-rf', d)));
  }

  /**
   * Manually uninstall the K3s-installed copy of Traefik, if it exists.
   * This exists to work around https://github.com/k3s-io/k3s/issues/5103
   */
  async uninstallTraefik(client: KubeClient) {
    try {
      const customApi = client.k8sClient.makeApiClient(CustomObjectsApi);
      const { body: response } = await customApi.listNamespacedCustomObject('helm.cattle.io', 'v1', 'kube-system', 'helmcharts');
      const charts: V1HelmChart[] = (response as any)?.items ?? [];

      await Promise.all(charts.filter((chart) => {
        const annotations = chart.metadata?.annotations ?? {};

        return chart.metadata?.name && (annotations['objectset.rio.cattle.io/owner-name'] === 'traefik');
      }).map((chart) => {
        const name = chart.metadata?.name;

        if (name) {
          console.debug(`Will delete helm chart ${ name }`);

          return customApi.deleteNamespacedCustomObject('helm.cattle.io', 'v1', 'kube-system', 'helmcharts', name);
        }
      }));
    } catch (ex) {
      console.error('Error uninstalling Traefik', ex);
    }
  }

  /**
   * Rancher Desktop's exposed `kubectl` utility is actually a wrapper around `kuberlr`,
   * which guarantees that the actual true `kubectl` utility is compatible
   * with the current version of kubernetes on the server.
   *
   * Calling `kubectl --context rancher-desktop cluster-info` is a good way to verify
   * that the correct version of `kubectl` is available, or to let the user know there
   * was a problem downloading it.
   *
   * @param version
   */
  async getCompatibleKubectlVersion(version: semver.SemVer): Promise<void> {
    const commandArgs = ['--context', 'rancher-desktop', 'cluster-info'];

    try {
      const { stdout, stderr } = await childProcess.spawnFile(executable('kubectl'),
        commandArgs,
        { stdio: ['ignore', 'pipe', 'pipe'] });

      if (stdout) {
        console.info(stdout);
      }
      if (stderr) {
        console.log(stderr);
      }
    } catch (ex: any) {
      console.error(`Error priming kuberlr: ${ ex }`);
      console.log(`Output from kuberlr:\nex.stdout: [${ ex.stdout ?? 'none' }],\nex.stderr: [${ ex.stderr ?? 'none' }]`);
      const pattern = /Right kubectl missing, downloading.+Error while trying to get contents of .+\/kubernetes-release/s;

      if (pattern.test(ex.stderr)) {
        const major = version.major;
        const minor = version.minor;
        const lowMinor = minor === 0 ? 0 : minor - 1;
        const highMinor = minor + 1;
        const homeDirName = os.platform().startsWith('win') ? (findHomeDir() ?? '%HOME%') : '~';
        const kuberlrCacheDirName = `${ os.platform() }-${ process.env.M1 ? 'arm64' : 'amd64' }`;
        const options: Electron.MessageBoxOptions = {
          message: "Can't download a compatible version of kubectl in offline-mode",
          detail:  `Please acquire a version in the range ${ major }.${ lowMinor } - ${ major }.${ highMinor } and install in '${ path.join(homeDirName, '.kuberlr', kuberlrCacheDirName) }'`,
          type:    'error',
          buttons: ['OK'],
          title:   'Network failure',
        };

        await showMessageBox(options, true);
      } else {
        console.log('Failed to match a kuberlr network access issue.');
      }
    }
  }

  /**
   * Check if the given Kubernetes version requires the port forwarding fix
   * (where we listen on a local port).
   *
   * @param version Kubernetes version; null if no Kubernetes will run.
   */
  static requiresPortForwardingFix(version: semver.SemVer | undefined): boolean {
    if (!version) {
      // When Kubernetes is disabled, don't try to do NodePort forwarding.
      return false;
    }
    switch (true) {
    case version.major !== 1: return true;
    case version.minor < 21: return false;
    case version.minor === 21: return version.patch >= 12;
    case version.minor === 22: return version.patch >= 10;
    case version.minor === 23: return version.patch >= 7;
    case version.minor >= 24: return true;
    default:
      throw new Error(`Unexpected Kubernetes version ${ version }`);
    }
  }

  /**
   * Helper for implementing KubernetesBackend.requiresRestartReasons
   */
  requiresRestartReasons(
    currentSettings: K8s.BackendSettings,
    desiredSettings: RecursivePartial<K8s.BackendSettings>,
    checkers: RequiresRestartCheckers,
    extras: ExtraRequiresReasons = {},
  ): K8s.RestartReasons {
    const results: K8s.RestartReasons = {};
    const NotFound = Symbol('not-found');

    /**
     * Check the given settings against the last-applied settings to see if we
     * need to restart the backend.
     * @param key The identifier to use for the UI.
     */
    function cmp<K extends keyof K8s.RestartReasons>(key: K, checker?: RequiresRestartSeverityChecker<K>) {
      const current = _.get(currentSettings, key, NotFound);
      const desired = _.get(desiredSettings, key, NotFound);

      if (current === NotFound) {
        throw new Error(`Invalid restart check: path ${ path } not found on current values`);
      }
      if (desired === NotFound) {
        // desiredSettings does not contain the full set.
        return;
      }
      if (!_.isEqual(current, desired)) {
        results[key] = {
          current, desired, severity: checker ? checker(current, desired) : 'restart',
        };
      }
    }

    for (const [key, checker] of Object.entries(checkers)) {
      // We need the casts here because TypeScript can't match up the key with
      // its corresponding checker.
      cmp(key as any, checker as any);
    }

    for (const [key, entry] of Object.entries(extras)) {
      if (!entry) {
        // The list is hard-coded; getting here means a programming error.
        throw new Error(`Invalid requiresRestartReasons extra key ${ key }`);
      }

      const desired = _.get(desiredSettings, key);
      const { current, severity } = entry;

      if (!_.isEqual(current, desired)) {
        results[key as keyof K8s.RestartReasons] = {
          current, desired, severity: severity ? (severity as any)(current, desired) : 'restart',
        };
      }
    }

    return results;
  }
}

interface V1HelmChart {
  apiVersion?: 'helm.cattle.io/v1';
  kind?: 'HelmChart';
  metadata?: V1ObjectMeta;
}
