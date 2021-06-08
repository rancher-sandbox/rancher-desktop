// Kuberentes backend for Windows, based on WSL2 + k3s

import { Console } from 'console';
import events from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import timers from 'timers';
import util from 'util';

import fetch from 'node-fetch';
import XDGAppPaths from 'xdg-app-paths';

import * as childProcess from '../utils/childProcess';
import Logging from '../utils/logging';
import { Settings } from '../config/settings';
import resources from '../resources';
import * as K8s from './k8s';
import K3sHelper from './k3sHelper';

const console = new Console(Logging.wsl.stream);
const paths = XDGAppPaths('rancher-desktop');
const INSTANCE_NAME = 'rancher-desktop';

// Helpers for setting progress
enum Progress {
  INDETERMINATE = '<indeterminate>',
  DONE = '<done>',
  EMPTY = '<empty>',
}

/**
 * Enumeration for tracking what operation the backend is undergoing.
 */
enum Action {
  NONE = 'idle',
  STARTING = 'starting',
  STOPPING = 'stopping',
}

export default class WSLBackend extends events.EventEmitter implements K8s.KubernetesBackend {
  constructor() {
    super();
    this.k3sHelper.on('versions-updated', () => this.emit('versions-updated'));
    this.k3sHelper.initialize();
  }

  protected get distroFile() {
    return resources.get(os.platform(), 'distro-0.1.tar');
  }

  protected get downloadURL() {
    return 'https://github.com/k3s-io/k3s/releases/download';
  }

  protected cfg: Settings['kubernetes'] | undefined;

  protected process: childProcess.ChildProcess | null = null;

  protected client: K8s.Client | null = null;

  /** Interval handle to update the progress. */
  // The return type is odd because TypeScript is pulling in some of the DOM
  // definitions here, which has an incompatible setInterval/clearInterval.
  protected progressInterval: ReturnType<typeof timers.setInterval> | undefined;

  /** The version of Kubernetes currently running. */
  protected activeVersion = '';

  /** Helper object to manage available K3s versions. */
  protected k3sHelper = new K3sHelper();

  /**
   * The current operation underway; used to avoid responding to state changes
   * when we're in the process of doing a different one.
   */
  protected currentAction: Action = Action.NONE;

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

  progress: { current: number, max: number, description?: string, transitionTime?: Date }
    = { current: 0, max: 0 };

  protected setProgress(current: Progress, description?: string): void;
  protected setProgress(current: number, max: number): void;

  /**
   * Set the Kubernetes start/stop progress.
   * @param current The current progress, from 0 to max.
   * @param max The maximum progress.
   */
  protected setProgress(current: number | Progress, maxOrDescription?: number | string): void {
    let max: number;

    if (typeof current !== 'number') {
      switch (current) {
      case Progress.INDETERMINATE:
        current = max = -1;
        break;
      case Progress.DONE:
        current = max = 1;
        break;
      case Progress.EMPTY:
        current = 0;
        max = 1;
        break;
      default:
        throw new Error('Invalid progress given');
      }
      if (typeof maxOrDescription === 'string') {
        // A description is given
        this.progress.description = maxOrDescription;
        this.progress.transitionTime = new Date();
      } else {
        // No description is given, clear it.
        this.progress.description = undefined;
        this.progress.transitionTime = undefined;
      }
    } else {
      max = maxOrDescription as number;
    }
    if (typeof max !== 'number') {
      // This should not be reachable; it requires setProgress(number, undefined)
      // which is not allowed by the overload signatures.
      throw new TypeError('Invalid max');
    }
    Object.assign(this.progress, { current, max });
    this.emit('progress');
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
      const version = this.cfg?.version || availableVersions[0];

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

    return stdout.split(/[\r\n]+/).includes(INSTANCE_NAME);
  }

  /**
   * Ensure that the distribution has been installed into WSL2.
   */
  protected async ensureDistroRegistered(): Promise<void> {
    if (await this.isDistroRegistered()) {
      // k3s is already registered.
      return;
    }
    const distroPath = path.join(paths.state(), 'distro');
    const args = ['--import', INSTANCE_NAME, distroPath, this.distroFile, '--version', '2'];

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

  async getBackendInvalidReason(): Promise<K8s.KubernetesError | null> {
    // Check if wsl.exe is available
    try {
      await this.isDistroRegistered();
    } catch (ex) {
      if ((ex as NodeJS.ErrnoException).code === 'ENOENT') {
        console.log('Error launching WSL: it does not appear to be installed.');
        const message = `
          Windows Subsystem for Linux does not appear to be installed.

          Please install it manually:

          https://docs.microsoft.com/en-us/windows/wsl/install-win10
        `.replace(/[ \t]{2,}/g, '');

        return new K8s.KubernetesError('WSL Not Installed', message);
      }
      throw ex;
    }

    return null;
  }

  async start(config: Settings['kubernetes']): Promise<void> {
    this.cfg = config;
    this.currentAction = Action.STARTING;
    try {
      this.setState(K8s.State.STARTING);

      if (this.progressInterval) {
        timers.clearInterval(this.progressInterval);
      }
      this.setProgress(Progress.INDETERMINATE, 'Downloading Kubernetes components');
      this.progressInterval = timers.setInterval(() => {
        const statuses = [
          this.k3sHelper.progress.checksum,
          this.k3sHelper.progress.exe,
          this.k3sHelper.progress.images,
        ];
        const sum = (key: 'current' | 'max') => {
          return statuses.reduce((v, c) => v + c[key], 0);
        };

        this.setProgress(sum('current'), sum('max'));
      }, 250);

      const desiredVersion = await this.desiredVersion;

      await Promise.all([
        this.ensureDistroRegistered(),
        this.k3sHelper.ensureK3sImages(desiredVersion),
      ]);
      // We have no good estimate for the rest of the steps, go indeterminate.
      timers.clearInterval(this.progressInterval);
      this.progressInterval = undefined;
      this.setProgress(Progress.INDETERMINATE, 'Starting Kubernetes');

      // If we were previously running, stop it now.
      this.process?.kill('SIGTERM');

      // Run run-k3s with NORUN, to set up the environment.
      await childProcess.spawnFile('wsl.exe',
        ['--distribution', INSTANCE_NAME, '--exec', '/usr/local/bin/run-k3s', desiredVersion],
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
      const args = ['--distribution', INSTANCE_NAME, '--exec', '/usr/local/bin/k3s', 'server'];
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
          this.setProgress(Progress.EMPTY);
        }
      });

      // Wait for k3s server; note that we're deliberately sending an HTTP request
      // to an HTTPS server, and expecting an error response back.
      while (true) {
        try {
          const resp = await fetch('http://localhost:6444');

          if (resp.status === 400) {
            break;
          }
        } catch (e) {
          if (!['ECONNREFUSED', 'ECONNRESET'].includes(e.code)) {
            throw e;
          }
        }
        await util.promisify(setTimeout)(500);
      }

      try {
        await this.k3sHelper.updateKubeconfig(
          'wsl.exe', '--distribution', INSTANCE_NAME, '--exec', '/usr/local/bin/kubeconfig');
      } catch (err) {
        console.log(`k3sHelper.updateKubeconfig failed: ${ err }. Will retry...`);
        throw err;
      }

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
          ['--user', 'root', '--distribution', INSTANCE_NAME, 'mount', '--make-shared', '/'],
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
      this.setProgress(Progress.DONE);
    } catch (ex) {
      this.setState(K8s.State.ERROR);
      this.setProgress(Progress.EMPTY);
      throw ex;
    } finally {
      if (this.progressInterval) {
        timers.clearInterval(this.progressInterval);
        this.progressInterval = undefined;
      }
      this.currentAction = Action.NONE;
    }
  }

  async stop(): Promise<void> {
    // When we manually call stop, the subprocess will terminate, which will
    // cause stop to get called again.  Prevent the re-entrancy.
    if (this.currentAction !== Action.NONE) {
      return;
    }
    this.currentAction = Action.STOPPING;
    try {
      this.setState(K8s.State.STOPPING);
      this.setProgress(Progress.INDETERMINATE, 'Stopping Kubernetes');
      this.process?.kill('SIGTERM');
      try {
        await childProcess.spawnFile('wsl.exe', ['--terminate', INSTANCE_NAME], {
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
      this.setProgress(Progress.DONE);
    } catch (ex) {
      this.setState(K8s.State.ERROR);
      this.setProgress(Progress.EMPTY);
      throw ex;
    } finally {
      this.currentAction = Action.NONE;
    }
  }

  async del(): Promise<void> {
    await this.stop();
    this.setProgress(Progress.INDETERMINATE, 'Deleting Kubrnetes');
    await childProcess.spawnFile('wsl.exe', ['--unregister', INSTANCE_NAME], {
      stdio:       ['ignore', await Logging.wsl.fdStream, await Logging.wsl.fdStream],
      windowsHide: true,
    });
    this.cfg = undefined;
    this.setProgress(Progress.DONE);
  }

  async reset(config: Settings['kubernetes']): Promise<void> {
    // For K3s, doing a full reset is fast enough.
    await this.del();
    await this.start(config);
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
