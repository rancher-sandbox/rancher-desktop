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
  protected readonly releaseAPIPagination = 100;
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

  protected async updateCache(): Promise<void> {
    const cacheFile = path.join(paths.cache(), 'k3s-versions.json');

    try {
      try {
        const cacheData: string[] =
          JSON.parse(await util.promisify(fs.readFile)(cacheFile, 'utf-8'));

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

      let wantMoreVersions = true;
      let url = this.releaseAPIURL;

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

        wantMoreVersions = false;
        for (const entry of (await response.json()) as ReleaseAPIEntry[]) {
          const version = semver.parse(entry.tag_name);

          if (!version) {
            console.log(`Skipping empty version ${ entry.tag_name }`);
            continue;
          }

          if (version < this.minimumVersion) {
            console.log(`Version ${ version } is less than the minimum ${ this.minimumVersion }, skipping.`);
            continue;
          }

          let wantVersion = true;
          const build = buildVersion(version);
          const oldVersion = this.versions[`v${ version.version }`];

          if (oldVersion) {
            const oldBuild = buildVersion(oldVersion);

            wantVersion = build > oldBuild;
            wantMoreVersions ||= wantVersion;
            if (build === oldBuild) {
              // If we see the _exact_ same version, we've found where we stopped
              // before.
              console.log(`Found old version ${ version.raw }, stopping.`);
              wantMoreVersions = false;
              break;
            }
          }

          if (wantVersion) {
            wantMoreVersions = true;
            if (version.prerelease.length > 0) {
              // Skip any pre-releases.
              continue;
            }
            // Check that this release has all the assets we expect
            if (this.filenames.every(name => entry.assets.some(v => v.name === name))) {
              console.log(`Adding version ${ version.raw }`);
              this.versions[`v${ version.version }`] = version;
            }
          } else {
            console.log(`Skipping old version ${ version.raw }, have build ${ oldVersion.raw }`);
          }
        }
      }
      console.log(`Got ${ Object.keys(this.versions).length } versions.`);
      await util.promisify(fs.mkdir)(paths.cache(), { recursive: true });
      await util.promisify(fs.writeFile)(cacheFile, JSON.stringify(Object.values(this.versions).map(v => v.raw)), 'utf-8');

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
