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
import { KubeConfig } from '@kubernetes/client-node';
import { ActionOnInvalid } from '@kubernetes/client-node/dist/config_types';
import yaml from 'yaml';

import * as childProcess from '@/utils/childProcess';
import Logging from '@/utils/logging';
import resources from '@/resources';
import DownloadProgressListener from '@/utils/DownloadProgressListener';
import safeRename from '@/utils/safeRename';
import paths from '@/utils/paths';
import * as K8s from '@/k8s-engine/k8s';
// TODO: Replace with the k8s version after kubernetes-client/javascript/pull/748 lands
// const k8s = require('@kubernetes/client-node');
import { findHomeDir } from '@/config/findHomeDir';
import { isUnixError } from '@/typings/unix.interface';

const console = Logging.k8s;

/**
 * ShortVersion is the version string without any k3s suffixes; this is the
 * version we present to the user.
 */
export type ShortVersion = string;

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
  protected readonly channelApiUrl = 'https://update.k3s.io/v1-release/channels';
  protected readonly channelApiAccept = 'application/json';
  protected readonly releaseApiUrl = 'https://api.github.com/repos/k3s-io/k3s/releases?per_page=100';
  protected readonly releaseApiAccept = 'application/vnd.github.v3+json';
  protected readonly cachePath = path.join(paths.cache, 'k3s-versions.json');
  protected readonly minimumVersion = new semver.SemVer('1.15.0');

  constructor(arch: K8s.Architecture) {
    super();
    this.arch = arch;
  }

  /**
   * Versions that we know to exist.  This is indexed by the version string,
   * without any build information (since we only ever take the latest build).
   * Note that the key is in the form `1.0.0` (i.e. without the `v` prefix).
   */
  protected versions: Record<ShortVersion, K8s.VersionEntry> = {};

  protected pendingInitialize: Promise<void> | undefined;

  /** The current architecture. */
  protected readonly arch: K8s.Architecture;

  /**
   * Read the cached data and fill out this.versions.
   * The cache file consists of an array of VersionEntry.
   */
  protected async readCache() {
    try {
      const cacheData: (string | { version: string, channels: string[] | undefined })[] =
        JSON.parse(await util.promisify(fs.readFile)(this.cachePath, 'utf-8'));

      for (const entry of cacheData) {
        if (typeof entry === 'string') {
          // Old-style cache: don't load it, because doing so prevents us from
          // picking up channel labels for existing versions.
          return;
        }
        const version = semver.parse(entry.version);

        if (version) {
          this.versions[version.version] = { version, channels: entry.channels };
        }
      }
    } catch (ex) {
      if ((ex as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw ex;
      }
    }
  }

  /** Write this.versions into the cache file. */
  protected async writeCache() {
    const cacheData = Object.values(this.versions).map((entry) => {
      return { version: entry.version.raw, channels: entry.channels };
    });
    const serializedCacheData = JSON.stringify(cacheData, undefined, 2);

    await fs.promises.mkdir(paths.cache, { recursive: true });
    await fs.promises.writeFile(this.cachePath, serializedCacheData, 'utf-8');
  }

  /** The files we need to download for the current architecture. */
  protected get filenames() {
    switch (this.arch) {
    case 'x86_64':
      return {
        exe:      'k3s',
        images:   'k3s-airgap-images-amd64.tar',
        checksum: 'sha256sum-amd64.txt',
      };
    case 'aarch64':
      return {
        exe:      'k3s-arm64',
        images:   'k3s-airgap-images-arm64.tar',
        checksum: 'sha256sum-arm64.txt',
      };
    }
  }

  /**
   * Process one version entry retrieved from GitHub, inserting it into the
   * cache.
   * @param entry The GitHub API response entry to process.
   * @param recommended The set of recommended versions and their names.
   * @returns Whether more entries should be fetched.  Note that we will err on
   *          the side of getting more versions if we are unsure.
   */
  protected processVersion(entry: ReleaseAPIEntry, recommended: Record<string, string[]>): boolean {
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
        console.debug(JSON.stringify(this.versions[version.version], undefined, 2),
          Object.keys(this.versions));

        return false;
      }
    }

    // Check that this release has all the assets we expect.
    if (Object.values(this.filenames).every(name => entry.assets.some(v => v.name === name))) {
      console.log(`Adding version ${ version.raw } (${ recommended[version.raw] })`);
      this.versions[version.version] = { version, channels: recommended[version.raw] };
    } else {
      console.log(`Skipping version ${ version.raw } due to missing files`);
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
      const recommended: Record<string, string[]> = {};
      let wantMoreVersions = true;
      let url = this.releaseApiUrl;

      await this.readCache();

      console.log(`Updating release version cache with ${ Object.keys(this.versions).length } items in cache`);
      const channelResponse = await fetch(this.channelApiUrl, { headers: { Accept: this.channelApiAccept } });

      if (channelResponse.ok) {
        const channels = (await channelResponse.json()) as { data?: { name: string, latest: string }[] };
        const nameSet: Record<string, string[]> = {};

        console.log(`Got K3s update channel data: ${ channels.data?.map(ch => ch.name) }`);
        for (const channel of channels.data ?? []) {
          nameSet[channel.latest] = (nameSet[channel.latest] ?? []).concat(channel.name);
        }
        for (const [key, names] of Object.entries(nameSet)) {
          recommended[key] = names.sort((a, b) => {
            // The names are either a word ("stable", "testing", etc.) or a
            // branch ("v1.2", etc.). The sort should be words first, then
            // branch.  For words, list "stable" before anything else.
            // We assume no release can match two branch channels at once.
            const versionRegex = /^v(?<major>\d+)\.(?<minor>\d+)$/;

            if (a === 'stable' || b === 'stable') {
              // sort "stable" at the front
              return a === 'stable' ? -1 : 1;
            }
            if (versionRegex.test(a) || versionRegex.test(b)) {
              return versionRegex.test(a) ? 1 : -1;
            }

            return a.localeCompare(b);
          });
        }
        console.log('Recommended versions:', recommended);
      }

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
          if (!this.processVersion(entry, recommended)) {
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
   * The versions that are available to install.
   */
  get availableVersions(): Promise<K8s.VersionEntry[]> {
    return this.initialize().then(() => {
      return Object.values(this.versions).sort((a, b) => -a.version.compare(b.version));
    });
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
        const promises = [this.filenames.exe, this.filenames.images].map(async(filename) => {
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
        const fileURL = `${ this.downloadUrl }/${ version.raw }/${ filename }`;
        const outPath = path.join(workDir, filename);

        console.log(`Will download ${ filekey } ${ fileURL } to ${ outPath }`);
        const response = await fetch(fileURL);

        if (!response.ok) {
          throw new Error(`Error downloading ${ filename } ${ version }: ${ response.statusText }`);
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
        recursive: true, maxRetries: 3, force: true
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
              host, port, rejectUnauthorized: false
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
  async findKubeConfigToUpdate(contextName: string): Promise<string> {
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
    // TODO: Replace with k8s.findHomeDir() after kubernetes-client/javascript/pull/748 lands
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
      try {
        userConfig.loadFromFile(userPath, { onInvalidEntry: ActionOnInvalid.FILTER });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.log(`Error trying to load kubernetes config file ${ userPath }:`, err);
        }
        // continue to merge into an empty userConfig == `{ contexts: [], clusters: [], users: [] }`
      }
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

      await childProcess.spawnFile(
        resources.executable('kubectl'), ['config', 'use-context', contextName],
        { stdio: console, windowsHide: true });
    } finally {
      await fs.promises.rm(workDir, {
        recursive: true, force: true, maxRetries: 10
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
   * @param execAsRoot A function to run commands on the VM as root.
   */
  async deleteKubeState(execAsRoot: (...args: string[]) => Promise<void>) {
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
    await Promise.all(directories.map(d => execAsRoot('rm', '-rf', d)));
  }
}
