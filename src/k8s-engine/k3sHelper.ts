import { Console } from 'console';
import crypto from 'crypto';
import events from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import stream from 'stream';
import tls from 'tls';
import util from 'util';

import fetch from 'node-fetch';
import semver from 'semver';
import XDGAppPaths from 'xdg-app-paths';
import { KubeConfig } from '@kubernetes/client-node';
import yaml from 'yaml';

import * as childProcess from '../utils/childProcess';
import Logging from '../utils/logging';
import resources from '../resources';
import DownloadProgressListener from '../utils/DownloadProgressListener';
import safeRename from '../utils/safeRename';

const console = new Console(Logging.k8s.stream);
const paths = XDGAppPaths('rancher-desktop');

export interface ReleaseAPIEntry {
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
 *
 * Note that this is only exported for testing.
 * @param version The version to parse
 * @returns The K3s build version
 */
export function buildVersion(version: semver.SemVer) {
  const [_, numString] = /k3s(\d+)/.exec(version.build[0]) || [undefined, -1];

  return parseInt(`${ numString || '-1' }`);
}

export default class K3sHelper extends events.EventEmitter {
  protected readonly releaseApiUrl = 'https://api.github.com/repos/k3s-io/k3s/releases?per_page=100';
  protected readonly releaseApiAccept = 'application/vnd.github.v3+json';
  protected readonly cachePath = path.join(paths.cache(), 'k3s-versions.json');
  readonly filenames = ['k3s', 'k3s-airgap-images-amd64.tar', 'sha256sum-amd64.txt'];
  protected readonly minimumVersion = new semver.SemVer('1.15.0');

  /**
   * Versions that we know to exist.  This is indexed by the version string,
   * without any build information (since we only ever take the latest build).
   * Note that the key is in the form `v1.0.0` (i.e. has the `v` prefix).
   */
  protected versions: Record<string, semver.SemVer> = {};

  protected pendingUpdate: Promise<void> | undefined;

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

  /**
   * Produce a promise that is resolved after a short delay, used for retrying
   * API requests when GitHub API requests are being rate-limited.
   */
  protected async delayForWaitLimiting(): Promise<void> {
    // This is a separate method so that we could override it in the tests.
    // Jest cannot override setTimeout: https://stackoverflow.com/q/52727220/
    await util.promisify(setTimeout)(1_000);
  }

  protected async updateCache(): Promise<void> {
    try {
      let wantMoreVersions = true;
      let url = this.releaseApiUrl;

      await this.readCache();

      console.log('Updating release version cache');
      while (wantMoreVersions && url) {
        const response = await fetch(url, { headers: { Accept: this.releaseApiAccept } });

        console.log(`Fetching releases from ${ url } -> ${ response.statusText }`);
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
      console.log(`Got ${ Object.keys(this.versions).length } versions.`);
      await this.writeCache();

      this.emit('versions-updated');
    } catch (e) {
      console.error(e);
      throw e;
    }
  }

  /**
   * Initialize the version fetcher.
   * @returns A promise that is resolved when the initialization is complete.
   */
  initialize(): Promise<void> {
    if (!this.pendingUpdate) {
      this.pendingUpdate = this.updateCache();
    }

    return this.pendingUpdate;
  }

  get availableVersions(): Promise<string[]> {
    return this.initialize().then(() => {
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
  }

  /**
  * Ensure that the K3s assets have been downloaded into the cache, which is
  * at (paths.cache())/k3s.
  * @param version The version of K3s to download.
  */
  async ensureK3sImages(version: string): Promise<void> {
    const cacheDir = path.join(paths.cache(), 'k3s');
    const filenames = {
      exe:      'k3s',
      images:   'k3s-airgap-images-amd64.tar',
      checksum: 'sha256sum-amd64.txt',
    } as const;

    console.log(`Ensuring images available for K3s ${ version }`);
    const verifyChecksums = async(dir: string): Promise<Error | null> => {
      try {
        const sumFile = await fs.promises.readFile(path.join(dir, 'sha256sum-amd64.txt'), 'utf-8');
        const sums: Record<string, string> = {};

        for (const line of sumFile.split(/[\r\n]+/)) {
          const match = /^\s*([0-9a-f]+)\s+(.*)/i.exec(line.trim());

          if (!match) {
            continue;
          }
          const [, sum, filename] = match;

          sums[filename] = sum;
        }
        const promises = [filenames.exe, filenames.images].map(async(filename) => {
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
        if (ex.code !== 'ENOENT') {
          throw ex;
        }

        return ex;
      }
    };

    await fs.promises.mkdir(cacheDir, { recursive: true });
    if (!await verifyChecksums(path.join(cacheDir, version))) {
      console.log(`Cache at ${ cacheDir } is valid.`);

      return;
    }

    const workDir = await fs.promises.mkdtemp(path.join(cacheDir, `tmp-${ version }-`));

    try {
      await Promise.all(Object.entries(filenames).map(async([filekey, filename]) => {
        const fileURL = `${ this.downloadUrl }/${ version }/${ filename }`;

        const outPath = path.join(workDir, filename);

        console.log(`Will download ${ filekey } ${ fileURL } to ${ outPath }`);
        const response = await fetch(fileURL);

        if (!response.ok) {
          throw new Error(`Error downloading ${ filename } ${ version }: ${ response.statusText }`);
        }
        const status = this.progress[<keyof typeof filenames>filekey];

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
      await safeRename(workDir, path.join(cacheDir, version));
    } finally {
      await fs.promises.rmdir(workDir, { recursive: true, maxRetries: 3 });
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
  async waitForServerReady(getHost: () => Promise<string|undefined>, port: number): Promise<void> {
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
              host, port, rejectUnauthorized: false
            },
            () => {
              const { subjectaltname } = socket.getPeerCertificate();
              const names = subjectaltname.split(',').map( s => s.trim());
              const acceptable = [`IP Address:${ host }`, `DNS:${ host }`];

              if (names.some(name => acceptable.includes(name))) {
                // We got a certificate with a SubjectAltName that includes the
                // host we're looking for.
                resolve();
              }
              reject({ code: 'ENOHOST' });
            });

          socket.on('error', reject);
        });
        break;
      } catch (error) {
        switch (error.code) {
        case 'ENOHOST':
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
   * Find the home directory, in a way that is compatible with the
   * @kubernetes/client-node package.
   */
  protected async findHome(): Promise<string | null> {
    const tryAccess = async(path: string) => {
      try {
        await fs.promises.access(path);

        return true;
      } catch {
        return false;
      }
    };

    if (process.env.HOME && await tryAccess(process.env.HOME)) {
      return process.env.HOME;
    }
    if (process.env.HOMEDRIVE && process.env.HOMEPATH) {
      const homePath = path.join(process.env.HOMEDRIVE, process.env.HOMEPATH);

      if (tryAccess(homePath)) {
        return homePath;
      }
    }
    if (process.env.USERPROFILE && tryAccess(process.env.USERPROFILE)) {
      return process.env.USERPROFILE;
    }

    return null;
  }

  /**
   * Find the kubeconfig file containing the given context; if none is found,
   * return the default kubeconfig path.
   * @param contextName The name of the context to look for
   */
  protected async findKubeConfigToUpdate(contextName: string): Promise<string> {
    const candidatePaths = process.env.KUBECONFIG?.split(path.delimiter) || [];

    for (const kubeConfigPath of candidatePaths) {
      const config = new KubeConfig();

      try {
        config.loadFromFile(kubeConfigPath);
        if (config.contexts.find(ctx => ctx.name === contextName)) {
          return kubeConfigPath;
        }
      } catch (err) {
        if (err.code !== 'ENOENT') {
          throw err;
        }
      }
    }
    const home = await this.findHome();

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
      // @kubernetes/client-node deosn't have an API to modify the configs...
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
          ...context, name: contextName, user: contextName, cluster: contextName
        };

        workConfig.currentContext = contextName;
      }
      const userPath = await this.findKubeConfigToUpdate(contextName);
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
      userConfig.loadFromFile(userPath);
      merge(userConfig.contexts, workConfig.contexts);
      merge(userConfig.users, workConfig.users);
      merge(userConfig.clusters, workConfig.clusters);
      const userYAML = this.ensureContentsAreYAML(userConfig.exportConfig());
      const writeStream = fs.createWriteStream(workPath, { mode: 0o600 });

      await new Promise((resolve, reject) => {
        writeStream.on('error', reject);
        writeStream.on('finish', resolve);
        writeStream.end(userYAML, 'utf-8');
      });
      await safeRename(workPath, userPath);

      // The config file we modified might not be the top level one.
      // Update the current context.
      console.log('Setting default context...');
      const logStream = await Logging.k8s.fdStream;

      await childProcess.spawnFile(
        resources.executable('kubectl'), ['config', 'use-context', contextName],
        { stdio: ['inherit', logStream, logStream] });
    } finally {
      await fs.promises.rmdir(workDir, { recursive: true, maxRetries: 10 });
    }
  }

  /**
   * We normally parse all the config files, yaml and json, with yaml.parse, so yaml.parse
   * should work with json here.
   * @param  {string} contents
   * @returns {string}
   */
  ensureContentsAreYAML(contents: string) {
    try {
      return yaml.stringify(yaml.parse(contents));
    } catch (err) {
      console.log(`Error in k3sHelper.ensureContentsAreYAML: ${ err }`);
    }

    return contents;
  }
}
