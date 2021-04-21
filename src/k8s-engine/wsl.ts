// Kuberentes backend for Windows, based on WSL2 + k3s

import childProcess from 'child_process';
import crypto from 'crypto';
import events from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import stream from 'stream';
import timers from 'timers';
import util from 'util';

import fetch from 'node-fetch';
import XDGAppPaths from 'xdg-app-paths';
import { KubeConfig } from '@kubernetes/client-node';

import { Settings } from '../config/settings';
import * as K8s from './k8s';

const paths = XDGAppPaths('rancher-desktop');

/**
 * ProgressListener observes a stream pipe to monitor progress.
 */
class ProgressListener extends stream.Transform {
  protected status: { current: number };

  constructor(status: { current: number }, options: stream.TransformOptions = {}) {
    super(options);
    this.status = status;
  }

  _transform(chunk: any, encoding: string, callback: stream.TransformCallback): void {
    if (encoding === 'buffer') {
      this.status.current += (chunk as Buffer).length;
    } else {
      this.status.current += (chunk as string).length;
    }
    callback(null, chunk);
  }
}

export default class WSLBackend extends events.EventEmitter implements K8s.KubernetesBackend {
  constructor(cfg: Settings['kubernetes']) {
    super();
    this.cfg = cfg;
  }

  /** Download URL for the distribution image */
  protected get distroURL() {
    return 'https://github.com/jandubois/tinyk3s/releases/download/v0.1/distro.tar';
  }

  protected get distroFile() {
    return path.join(paths.cache(), `distro-${ this.version }.tar`);
  }

  protected get downloadURL() {
    return 'https://github.com/k3s-io/k3s/releases/download';
  }

  protected cfg: Settings['kubernetes'];

  protected process: childProcess.ChildProcess | null = null;

  protected client: K8s.Client | null = null;

  /**
   * Variable to keep track of download progress
   */
  protected progress = {
    distro:   { current: 0, max: 0 },
    exe:      { current: 0, max: 0 },
    images:   { current: 0, max: 0 },
    checksum: { current: 0, max: 0 },
  }

  /** Interval handle to update the progress. */
  // The return type is odd because TypeScript is pulling in some of the DOM
  // definitions here, which has an incompatible setInterval/clearInterval.
  protected progressInterval: ReturnType<typeof timers.setInterval> | undefined;

  /** The current user-visible state of the backend. */
  protected internalState: K8s.State = K8s.State.STOPPED;
  get state() {
    return this.internalState;
  }

  protected setState(state: K8s.State) {
    this.internalState = state;
    this.emit('state-changed', this.state);
    switch (this.state) {
    case K8s.State.STOPPING:
    case K8s.State.STOPPED:
    case K8s.State.ERROR:
      this.client?.destroy();
    }
  }

  get version(): string {
    // TODO: actually do something sensible with this.
    return 'v1.19.7+k3s1';
  }

  get cpus(): Promise<number> {
    // This doesn't make sense for WSL2, since that's a global configuration.
    return Promise.resolve(0);
  }

  get memory(): Promise<number> {
    // This doesn't make sense for WSL2, since that's a global configuration.
    return Promise.resolve(0);
  }

  /**
   * Ensure that the distribution file exists; download the file if it is
   * missing.  It is expected that half-downloaded files will not be mistakenly
   * placed where we expect the file to be.
   */
  protected async ensureDistroFile(): Promise<void> {
    try {
      await util.promisify(fs.stat)(this.distroFile);

      return;
    } catch (e) {
      if (e.code !== 'ENOENT') {
        throw e;
      }
    }

    // If we reach here, then we need to download the tarball.
    // NodeJS doesn't have a way to create temporary files in the standard
    // library, and the popular libraries just use random names + O_EXCL
    await util.promisify(fs.mkdir)(paths.cache(), { recursive: true });
    const dir = await util.promisify(fs.mkdtemp)(path.join(paths.cache(), 'distro-'));
    const outPath = path.join(dir, path.basename(this.distroFile));

    try {
      const response = await fetch(this.distroURL);

      if (!response.ok) {
        throw new Error(`Failure downloading distribution: ${ response.statusText }`);
      }
      const progress = new ProgressListener(this.progress.distro);
      const writeStream = fs.createWriteStream(outPath);

      this.progress.distro.max = parseInt(response.headers.get('Content-Length') || '0');
      await util.promisify(stream.pipeline)(response.body, progress, writeStream);
      await util.promisify(fs.rename)(outPath, this.distroFile);
    } finally {
      try {
        await util.promisify(fs.unlink)(outPath);
      } catch (e) {
        if (e.code !== 'ENOENT') {
          // Re-throwing exceptions is no worse than not catching it at all.
          // eslint-disable-next-line no-unsafe-finally
          throw e;
        }
      }
      await util.promisify(fs.rmdir)(dir);
    }
  }

  protected async isDistroRegistered({ runningOnly = false } = {}): Promise<boolean> {
    const execFile = util.promisify(childProcess.execFile);
    const args = ['--list', '--quiet'];

    if (runningOnly) {
      args.push('--running');
    }
    const options: childProcess.ExecFileOptionsWithStringEncoding = {
      encoding:    'utf16le',
      windowsHide: true
    };
    const { stdout } = await execFile('wsl.exe', args, options);

    return stdout.split(/[\r\n]+/).includes('k3s');
  }

  /**
   * Ensure that the distribution has been installed into WSL2.
   */
  protected async ensureDistroRegistered(): Promise<void> {
    const execFile = util.promisify(childProcess.execFile);

    if (await this.isDistroRegistered()) {
      // k3s is already registered.
      return;
    }
    await this.ensureDistroFile();
    const distroPath = path.join(paths.state(), 'distro');
    const args = ['--import', 'k3s', distroPath, this.distroFile];
    const options: childProcess.SpawnOptions = { stdio: 'inherit', windowsHide: true };

    await util.promisify(fs.mkdir)(distroPath, { recursive: true });
    await execFile('wsl.exe', args, options);
    if (!await this.isDistroRegistered()) {
      throw new Error(`Error registration WSL2 distribution`);
    }
  }

  /**
   * Find the home directory, in a way that is compatible with the
   * @kubernetes/client-node package.
   */
  protected async findHome(): Promise<string | null> {
    const tryAccess = async(path: string) => {
      try {
        await util.promisify(fs.access)(path);

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

      await util.promisify(fs.mkdir)(kubeDir, { recursive: true });

      return path.join(kubeDir, 'config');
    }

    throw new Error(`Could not find a kubeconfig`);
  }

  /**
   * Update the user's kubeconfig such that the WSL/K3s context is available and
   * set as the current context.  This assumes that K3s is already running.
   */
  protected async updateKubeconfig(): Promise<void> {
    const contextName = 'rancher-desktop';
    const workDir = await util.promisify(fs.mkdtemp)(path.join(os.tmpdir(), 'rancher-desktop-kubeconfig-'));

    try {
      const workPath = path.join(workDir, 'kubeconfig');
      const workFD = await util.promisify(fs.open)(workPath, 'w+', 0o600);

      try {
        const k3sArgs = ['--distribution', 'k3s', '--exec', 'kubeconfig'];
        const k3sOptions: childProcess.SpawnOptions = { stdio: ['ignore', workFD, 'inherit'] };
        const k3sChild = childProcess.spawn('wsl.exe', k3sArgs, k3sOptions);

        await new Promise<void>((resolve, reject) => {
          k3sChild.on('error', reject);
          k3sChild.on('exit', (status, signal) => {
            if (status === 0) {
              return resolve();
            }
            const message = status ? `status ${ status }` : `signal ${ signal }`;

            reject(new Error(`Error getting kubeconfig: exited with ${ message }`));
          });
        });
      } finally {
        await util.promisify(fs.close)(workFD);
      }

      // For some reason, using KubeConfig.loadFromFile presents permissions
      // errors; doing the same ourselves seems to work better.  Since the file
      // comes from the WSL container, it must not contain any paths, so there
      // is no need to fix it up.
      const workConfig = new KubeConfig();
      const workContents = await util.promisify(fs.readFile)(workPath, { encoding: 'utf-8' });

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

      userConfig.loadFromFile(userPath);
      merge(userConfig.contexts, workConfig.contexts);
      merge(userConfig.users, workConfig.users);
      merge(userConfig.clusters, workConfig.clusters);
      const userYAML = userConfig.exportConfig();
      const writeStream = fs.createWriteStream(workPath);

      await new Promise((resolve, reject) => {
        writeStream.on('error', reject);
        writeStream.on('finish', resolve);
        writeStream.end(userYAML, 'utf-8');
      });
      await util.promisify(fs.rename)(workPath, userPath);
    } finally {
      await util.promisify(fs.rmdir)(workDir, { recursive: true, maxRetries: 10 });
    }
  }

  /**
   * Ensure that the K3s assets have been downloaded into the cache.
   * @param version The version of K3s to download
   */
  protected async ensureK3sImages(version: string): Promise<void> {
    const cacheDir = path.join(paths.cache(), 'k3s');
    const filenames = {
      exe:      'k3s',
      images:   'k3s-airgap-images-amd64.tar',
      checksum: 'sha256sum-amd64.txt',
    };

    const verifyChecksums = async(dir: string): Promise<Error | null> => {
      try {
        const sumFile = await util.promisify(fs.readFile)(path.join(dir, 'sha256sum-amd64.txt'), 'utf-8');
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

    await util.promisify(fs.mkdir)(cacheDir, { recursive: true });
    if (!await verifyChecksums(path.join(cacheDir, version))) {
      return;
    }

    const workDir = await util.promisify(fs.mkdtemp)(path.join(cacheDir, `tmp-${ version }-`));

    try {
      await Promise.all(Object.entries(filenames).map(async([filekey, filename]) => {
        const fileURL = `${ this.downloadURL }/${ version }/${ filename }`;
        const outPath = path.join(workDir, filename);

        console.log(`Will download ${ filekey } ${ fileURL } to ${ outPath }`);
        const response = await fetch(fileURL);

        if (!response.ok) {
          throw new Error(`Error downloading ${ filename } ${ version }: ${ response.statusText }`);
        }
        const status = this.progress[<keyof typeof filenames>filekey];
        const progress = new ProgressListener(status);
        const writeStream = fs.createWriteStream(outPath);

        status.max = parseInt(response.headers.get('Content-Length') || '0');
        await util.promisify(stream.pipeline)(response.body, progress, writeStream);
      }));

      const error = await verifyChecksums(workDir);

      if (error) {
        console.log('Error verifying checksums after download', error);
        throw error;
      }
      await util.promisify(fs.rename)(workDir, path.join(cacheDir, version));
    } finally {
      await util.promisify(fs.rmdir)(workDir, { recursive: true, maxRetries: 3 });
    }
  }

  async start(): Promise<void> {
    try {
      if (this.process) {
        await this.stop();
      }

      this.setState(K8s.State.STARTING);
      if (this.progressInterval) {
        timers.clearInterval(this.progressInterval);
      }
      this.emit('progress', 0, 0);
      this.progressInterval = timers.setInterval(() => {
        const sum = (key: 'current' | 'max') => {
          return Object.values(this.progress).reduce((v, c) => v + c[key], 0);
        };

        this.emit('progress', sum('current'), sum('max'));
      }, 250);
      await Promise.all([
        this.ensureDistroRegistered(),
        this.ensureK3sImages(this.version),
      ]);
      // We have no good estimate for the rest of the steps, go indeterminate.
      timers.clearInterval(this.progressInterval);
      this.progressInterval = undefined;
      this.emit('progress', 0, 0);
      // Run run-k3s with NORUN, to set up the environment.
      await new Promise<void>((resolve, reject) => {
        const args = ['--distribution', 'k3s', '--exec', 'run-k3s', this.version];
        const options: childProcess.SpawnOptions = {
          env: {
            ...process.env,
            // Need to set WSLENV to let run-k3s see the CACHE_DIR variable.
            // https://docs.microsoft.com/en-us/windows/wsl/interop#share-environment-variables-between-windows-and-wsl
            WSLENV:    `${ process.env.WSLENV }:CACHE_DIR/up:NORUN`,
            CACHE_DIR: path.join(paths.cache(), 'k3s'),
            NORUN:     'true',
          },
          stdio:       'inherit',
          windowsHide: true,
        };
        const child = childProcess.spawn('wsl.exe', args, options);

        child.on('error', reject);
        child.on('exit', (status, signal) => {
          if (status === 0 && signal === null) {
            return resolve();
          }
          const msg = status ? `status ${ status }` : `signal ${ signal }`;

          reject(new Error(`Could not set up K3s; exited with ${ msg }`));
        });
      });

      // Actually run K3s
      const args = ['--distribution', 'k3s', '--exec', '/usr/local/bin/k3s', 'server'];
      const options: childProcess.SpawnOptions = {
        env: {
          ...process.env,
          WSLENV:        `${ process.env.WSLENV }:IPTABLES_MODE`,
          IPTABLES_MODE: 'legacy',
        },
        stdio:       'inherit',
        windowsHide: true,
      };

      this.process = childProcess.spawn('wsl.exe', args, options);
      this.process.on('exit', (status, signal) => {
        if ([0, null].includes(status) && ['SIGTERM', null].includes(signal)) {
          console.log(`K3s exited gracefully.`);
          this.stop();
        } else {
          console.log(`K3s exited with status ${ status } signal ${ signal }`);
          this.stop();
          this.setState(K8s.State.ERROR);
        }
      });

      // Wait for k3s server; note that we're delibrately sending a HTTP request
      // to an HTTPS server, and expecting an error response back.
      while (true) {
        try {
          const resp = await fetch('http://localhost:6444');

          if (resp.status === 400) {
            break;
          }
        } catch (e) {
          if (e.code !== 'ECONNREFUSED') {
            throw e;
          }
        }
        await util.promisify(setTimeout)(500);
      }

      await this.updateKubeconfig();

      this.client = new K8s.Client();
      this.client.on('service-changed', (services) => {
        this.emit('service-changed', services);
      });
      this.setState(K8s.State.STARTED);
    } catch (ex) {
      this.setState(K8s.State.ERROR);
      throw ex;
    } finally {
      if (this.progressInterval) {
        timers.clearInterval(this.progressInterval);
        this.progressInterval = undefined;
      }
    }
  }

  async stop(): Promise<number> {
    const execFile = util.promisify(childProcess.execFile);
    const options: childProcess.SpawnOptions = {
      stdio:       'inherit',
      windowsHide: true,
    };

    try {
      this.setState(K8s.State.STOPPING);
      this.process?.kill('SIGTERM');
      try {
        await execFile('wsl.exe', ['--terminate', 'k3s'], options);
      } catch (ex) {
        // We might have failed to terminate because it was already stopped.
        if (await this.isDistroRegistered({ runningOnly: true })) {
          throw ex;
        }
      }
      this.setState(K8s.State.STOPPED);
    } catch (ex) {
      this.setState(K8s.State.ERROR);
      throw ex;
    }

    return 0;
  }

  async del(): Promise<number> {
    const execFile = util.promisify(childProcess.execFile);
    const options: childProcess.SpawnOptions = {
      stdio:       'inherit',
      windowsHide: true,
    };

    await this.stop();
    await execFile('wsl.exe', ['--unregister', 'k3s'], options);

    return 0;
  }

  async reset(): Promise<void> {
    // For K3s, doing a full reset is fast enough.
    await this.del();
    await this.start();
  }

  async factoryReset(): Promise<void> {
    const rmdir = util.promisify(fs.rmdir);

    await this.del();
    await rmdir(paths.cache(), { recursive: true });
    await rmdir(paths.state(), { recursive: true });
  }

  listServices(namespace?: string): K8s.ServiceEntry[] {
    return this.client?.listServices(namespace) || [];
  }

  requiresRestartReasons(): Promise<Record<string, [any, any] | []>> {
    // TODO: Check if any of this requires restart
    return Promise.resolve({});
  }

  async forwardPort(namespace: string, service: string, port: number): Promise<number | undefined> {
    return await this.client?.forwardPort(namespace, service, port);
  }

  async cancelForward(namespace: string, service: string, port: number): Promise<void> {
    await this.client?.cancelForwardPort(namespace, service, port);
  }
}
