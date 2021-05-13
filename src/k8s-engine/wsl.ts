// Kuberentes backend for Windows, based on WSL2 + k3s

import { Console } from 'console';
import events from 'events';
import fs from 'fs';
import path from 'path';
import stream from 'stream';
import timers from 'timers';
import util from 'util';

import fetch from 'node-fetch';
import XDGAppPaths from 'xdg-app-paths';

import * as childProcess from '../utils/childProcess';
import Logging from '../utils/logging';
import { Settings } from '../config/settings';
import DownloadProgressListener from '../utils/DownloadProgressListener';
import resources from '../resources';
import * as K8s from './k8s';
import K3sHelper from './k3sHelper';

const console = new Console(Logging.wsl.stream);
const paths = XDGAppPaths('rancher-desktop');

export default class WSLBackend extends events.EventEmitter implements K8s.KubernetesBackend {
  constructor(cfg: Settings['kubernetes']) {
    super();
    this.cfg = cfg;
    this.k3sHelper.on('versions-updated', () => this.emit('versions-updated'));
    this.k3sHelper.initialize();
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

  /** Variable to keep track of the download progress for the distribution. */
  protected distroProgress = { current: 0, max: 0 };

  /** Interval handle to update the progress. */
  // The return type is odd because TypeScript is pulling in some of the DOM
  // definitions here, which has an incompatible setInterval/clearInterval.
  protected progressInterval: ReturnType<typeof timers.setInterval> | undefined;

  /** The version of Kubernetes currently running. */
  protected activeVersion = '';

  /** Helper object to manage available K3s versions. */
  protected k3sHelper = new K3sHelper();

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
    return this.activeVersion;
  }

  get availableVersions(): Promise<string[]> {
    return this.k3sHelper.availableVersions;
  }

  get desiredVersion(): Promise<string> {
    return (async() => {
      const availableVersions = await this.k3sHelper.availableVersions;
      const version = this.cfg.version || availableVersions[0];

      if (!version) {
        throw new Error('No version available');
      }

      return this.k3sHelper.fullVersion(version);
    })();
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
      const progress = new DownloadProgressListener(this.distroProgress);
      const writeStream = fs.createWriteStream(outPath);

      this.distroProgress.max = parseInt(response.headers.get('Content-Length') || '0');
      await util.promisify(stream.pipeline)(response.body, progress, writeStream);
      try {
        await fs.promises.rename(outPath, this.distroFile);
      } catch (_) {
        // https://github.com/nodejs/node/issues/19077 :
        // rename uses hardlinks, fails cross-devices: marked 'wontfix'
        await fs.promises.copyFile(outPath, this.distroFile);
        await fs.promises.unlink(outPath);
      }
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
    const args = ['--list', '--quiet'];

    if (runningOnly) {
      args.push('--running');
    }

    const { stdout } = await childProcess.spawnFile('wsl.exe', args, {
      encoding:    'utf16le',
      stdio:       ['ignore', 'pipe', await Logging.wsl.fdStream],
      windowsHide: true,
    });

    console.log(`Registered distributions: ${ stdout.replace(/\s+/g, ' ') }`);

    return stdout.split(/[\r\n]+/).includes('k3s');
  }

  /**
   * Ensure that the distribution has been installed into WSL2.
   */
  protected async ensureDistroRegistered(): Promise<void> {
    if (await this.isDistroRegistered()) {
      // k3s is already registered.
      return;
    }
    await this.ensureDistroFile();
    const distroPath = path.join(paths.state(), 'distro');
    const args = ['--import', 'k3s', distroPath, this.distroFile, '--version', '2'];

    await fs.promises.mkdir(distroPath, { recursive: true });
    await childProcess.spawnFile('wsl.exe', args, {
      encoding:    'utf16le',
      stdio:       ['ignore', await Logging.wsl.fdStream, await Logging.wsl.fdStream],
      windowsHide: true
    });

    if (!await this.isDistroRegistered()) {
      throw new Error(`Error registering WSL2 distribution`);
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
        const statuses = [
          this.distroProgress,
          this.k3sHelper.progress.checksum,
          this.k3sHelper.progress.exe,
          this.k3sHelper.progress.images,
        ];
        const sum = (key: 'current' | 'max') => {
          return statuses.reduce((v, c) => v + c[key], 0);
        };

        this.emit('progress', sum('current'), sum('max'));
      }, 250);

      const desiredVersion = await this.desiredVersion;

      await Promise.all([
        this.ensureDistroRegistered(),
        this.k3sHelper.ensureK3sImages(desiredVersion),
      ]);
      // We have no good estimate for the rest of the steps, go indeterminate.
      timers.clearInterval(this.progressInterval);
      this.progressInterval = undefined;
      this.emit('progress', 0, 0);

      // Run run-k3s with NORUN, to set up the environment.
      await childProcess.spawnFile('wsl.exe',
        ['--distribution', 'k3s', '--exec', '/usr/local/bin/run-k3s', desiredVersion],
        {
          env:      {
            ...process.env,
            // Need to set WSLENV to let run-k3s see the CACHE_DIR variable.
            // https://docs.microsoft.com/en-us/windows/wsl/interop#share-environment-variables-between-windows-and-wsl
            WSLENV:    `${ process.env.WSLENV }:CACHE_DIR/up:NORUN`,
            CACHE_DIR: path.join(paths.cache(), 'k3s'),
            NORUN:     'true',
          },
          stdio:       ['ignore', await Logging.wsl.fdStream, await Logging.wsl.fdStream],
          windowsHide: true,
        });

      // Actually run K3s
      const args = ['--distribution', 'k3s', '--exec', '/usr/local/bin/k3s', 'server'];
      const options: childProcess.SpawnOptions = {
        env: {
          ...process.env,
          WSLENV:        `${ process.env.WSLENV }:IPTABLES_MODE`,
          IPTABLES_MODE: 'legacy',
        },
        stdio:       ['ignore', await Logging.k3s.fdStream, await Logging.k3s.fdStream],
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

      await this.k3sHelper.updateKubeconfig(
        'wsl.exe', '--distribution', 'k3s', '--exec', '/usr/local/bin/kubeconfig');

      this.client = new K8s.Client();
      await this.client.waitForServiceWatcher();
      this.client.on('service-changed', (services) => {
        this.emit('service-changed', services);
      });
      this.activeVersion = desiredVersion;

      // Temporary workaround: ensure root is mounted as shared -- this will be done later
      // Right now the builder pod needs to be restarted after the remount
      // TODO: When this code is removed, make `client.getActivePod` protected again.
      try {
        await childProcess.spawnFile(
          'wsl.exe',
          ['--user', 'root', '--distribution', 'k3s', 'mount', '--make-shared', '/'],
          {
            stdio:       ['ignore', await Logging.wsl.fdStream, await Logging.wsl.fdStream],
            windowsHide: true,
          });
        console.log('Waiting for ensuring root is shared');
        await util.promisify(setTimeout)(60_000);
        await childProcess.spawnFile(
          resources.executable('kim'),
          ['builder', 'install', '--force', '--no-wait'],
          {
            stdio:       ['ignore', await Logging.wsl.fdStream, await Logging.wsl.fdStream],
            windowsHide: true,
          });
        const startTime = Date.now();
        const maxWaitTime = 120_000;
        const waitTime = 3_000;

        while (true) {
          const currentTime = Date.now();

          if ((currentTime - startTime) > maxWaitTime) {
            console.log(`Waited more than ${ maxWaitTime / 1000 } secs, it might start up later`);
            break;
          }
          // Find a working pod
          const pod = await this.client.getActivePod('kube-image', 'builder');

          if (pod?.status?.phase === 'Running') {
            break;
          }
          await util.promisify(setTimeout)(waitTime);
        }
      } catch (e) {
        console.log(`Failed to restart the kim builder: ${ e.message }.`);
        console.log('The images page will probably be empty');
      }
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
    try {
      this.setState(K8s.State.STOPPING);
      this.process?.kill('SIGTERM');
      try {
        await childProcess.spawnFile('wsl.exe', ['--terminate', 'k3s'], {
          stdio:       ['ignore', await Logging.wsl.fdStream, await Logging.wsl.fdStream],
          windowsHide: true,
        });
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
    await this.stop();
    await childProcess.spawnFile('wsl.exe', ['--unregister', 'k3s'], {
      stdio:       ['ignore', await Logging.wsl.fdStream, await Logging.wsl.fdStream],
      windowsHide: true,
    });

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
