import events from 'events';
import fs from 'fs';
import path from 'path';
import util from 'util';

import fetch from 'node-fetch';
import semver from 'semver';
import XDGAppPaths from 'xdg-app-paths';

import { VersionLister } from './k8s';

const paths = XDGAppPaths('rancher-desktop');

type ReleaseAPIEntry = {
  // eslint-disable-next-line camelcase -- Field name comes from JSON
  tag_name: string;
  assets: {
    // eslint-disable-next-line camelcase -- Field name comes from JSON
    browser_download_url: string;
    name: string;
  }[];
}

/**
 * Given a version, return the K3s build version.
 * @param version The version to parse
 * @returns The K3s build version
 */
function buildVersion(version: semver.SemVer) {
  const [_, numString] = /k3s(\d+)/.exec(version.build[0]) || [undefined, -1];

  return parseInt(`${ numString || '-1' }`);
}

export default class K3sVersionLister extends events.EventEmitter implements VersionLister {
  protected readonly releaseAPIURL = 'https://api.github.com/repos/k3s-io/k3s/releases?per_page=100';
  protected readonly releaseAPIAccept = 'application/vnd.github.v3+json';
  protected readonly cachePath = path.join(paths.cache(), 'k3s-versions.json');
  protected readonly filenames = ['k3s', 'k3s-airgap-images-amd64.tar', 'sha256sum-amd64.txt'];
  protected readonly minimumVersion = new semver.SemVer('1.15.0');

  /**
   * Versions that we know to exist.  This is indexed by the version string,
   * without any build information (since we only ever take the latest build).
   * Note that the key is in the form `v1.0.0` (i.e. has the `v` prefix).
   */
  protected versions: Record<string, semver.SemVer> = {};

  protected pendingUpdate: Promise<void>;

  constructor() {
    super();
    this.pendingUpdate = this.updateCache();
  }

  /** Read the cached data and fill out this.versions. */
  protected async readCache() {
    try {
      const cacheData: string[] =
        JSON.parse(await util.promisify(fs.readFile)(this.cachePath, 'utf-8'));

      for (const versionString of cacheData) {
        const version = semver.parse(versionString);

        if (version) {
          this.versions[`v${ version.version }`] = version;
        }
      }
    } catch (ex) {
      if (ex.code !== 'ENOENT') {
        throw ex;
      }
    }
  }

  /** Write this.versions into the cache file. */
  protected async writeCache() {
    const cacheData = JSON.stringify(Object.values(this.versions).map(v => v.raw));

    await util.promisify(fs.mkdir)(paths.cache(), { recursive: true });
    await util.promisify(fs.writeFile)(this.cachePath, cacheData, 'utf-8');
  }

  /**
   * Process one version entry retrieved from GitHub, inserting it into the
   * cache.
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
    const build = buildVersion(version);
    const oldVersion = this.versions[`v${ version.version }`];

    if (oldVersion) {
      const oldBuild = buildVersion(oldVersion);

      if (build < oldBuild) {
        console.log(`Skipping old version ${ version.raw }, have build ${ oldVersion.raw }`);

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

        return false;
      }
    }

    // Check that this release has all the assets we expect.
    if (this.filenames.every(name => entry.assets.some(v => v.name === name))) {
      console.log(`Adding version ${ version.raw }`);
      this.versions[`v${ version.version }`] = version;
    }

    return true;
  }

  protected async updateCache(): Promise<void> {
    try {
      let wantMoreVersions = true;
      let url = this.releaseAPIURL;

      await this.readCache();

      while (wantMoreVersions && url) {
        const response = await fetch(url, { headers: { Accept: this.releaseAPIAccept } });

        console.log(`Fetching releases from ${ url } -> ${ response.statusText }`);
        if (!response.ok) {
          if (response.status === 403 && response.headers.get('X-RateLimit-Remaining') === '0') {
            // We hit the rate limit.
            // Roll back the page increase, and try this loop again in a second.
            await util.promisify(setTimeout)(1_000);
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
      console.log(`Got ${ Object.keys(this.versions).length } versions.`);
      await this.writeCache();

      this.emit('versions-updated');
    } catch (e) {
      console.error(e);
      throw e;
    }
  }

  get availableVersions(): Promise<string[]> {
    return this.pendingUpdate.then(() => {
      return Object.keys(this.versions).sort(semver.compare).reverse();
    });
  }

  fullVersion(shortVersion: string): string {
    const parsedVersion = semver.parse(shortVersion);

    if (!parsedVersion) {
      throw new Error(`Version ${ shortVersion } is not a valid version string.`);
    }

    const versionKey = `v${ parsedVersion.version }`;

    if (!(versionKey in this.versions)) {
      console.log(`Could not find full version for ${ shortVersion }`, Object.keys(this.versions).sort());
      throw new Error(`Could not find full version for ${ shortVersion }`);
    }

    return this.versions[versionKey].raw;
  }
}
