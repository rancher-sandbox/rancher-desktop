// Kubernetes backend for macOS, based on Hyperkit

import { Console } from 'console';
import events from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import timers from 'timers';

import Electron from 'electron';
import semver from 'semver';
import XDGAppPaths from 'xdg-app-paths';
import { exec as sudo } from 'sudo-prompt';

import * as childProcess from '../utils/childProcess';
import { Settings } from '../config/settings';
import resources from '../resources';
import Logging from '../utils/logging';
import * as K8s from './k8s';
import K3sHelper from './k3sHelper';

const paths = XDGAppPaths('rancher-desktop');
/** The GID of the 'admin' group on macOS */
const adminGroup = 80;

const console = new Console(Logging.k8s.stream);

/**
 * The possible states for the docker-machine driver.
 */
const enum DockerMachineDriverState {
  /** The VM does not exist, and can be created. */
  Missing,
  /** The VM exists, is not running, but can be transitioned to running. */
  Stopped,
  /** The VM exists, and is up. */
  Running,
  /** The VM needs to be deleted. */
  Error,
}

interface DockerMachineConfiguration {
  Driver: {
    CPU: number,
    Memory: number,
    IPAddress: string,
  },
  DriverName: string,
  Name: string,
}

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

export default class HyperkitBackend extends events.EventEmitter implements K8s.KubernetesBackend {
  constructor() {
    super();
    this.k3sHelper.on('versions-updated', () => this.emit('versions-updated'));
    this.k3sHelper.initialize();
  }

  protected readonly MACHINE_NAME = 'default';

  protected cfg: Settings['kubernetes'] | undefined;

  /** The version of Kubernetes currently running. */
  protected activeVersion = '';

  /** The port the Kubernetes server is listening on (default 6443) */
  protected currentPort = 0;

  /** Helper object to manage available K3s versions. */
  protected k3sHelper = new K3sHelper();

  protected client: K8s.Client | null = null;

  /** Interval handle to update the progress. */
  // The return type is odd because TypeScript is pulling in some of the DOM
  // definitions here, which has an incompatible setInterval/clearInterval.
  protected progressInterval: ReturnType<typeof timers.setInterval> | undefined;

  /**
   * The current operation underway; used to avoid responding to state changes
   * when we're in the process of doing a different one.
   */
  protected currentAction: Action = Action.NONE;

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

  protected process: childProcess.ChildProcess | null = null;

  get version(): string {
    return this.activeVersion;
  }

  get port(): number {
    return this.currentPort;
  }

  get availableVersions(): Promise<string[]> {
    return this.k3sHelper.availableVersions;
  }

  /**
   * Return the docker machine configuration.  This may return null if the
   * configuration is not available.
   */
  protected get dockerMachineConfig(): Promise<DockerMachineConfiguration | null> {
    return (async() => {
      if (this.state !== K8s.State.STARTED) {
        return null;
      }
      const configPath = path.join(
        paths.state(), 'driver', 'machines', this.MACHINE_NAME, 'config.json');

      try {
        const configBlob = await fs.promises.readFile(configPath, 'utf-8');

        return JSON.parse(configBlob);
      } catch (e) {
        if (e.code === 'ENOENT') {
          return null;
        }
        throw e;
      }
    })();
  }

  get cpus(): Promise<number> {
    return this.dockerMachineConfig.then(v => v?.Driver.CPU ?? 0);
  }

  get memory(): Promise<number> {
    return this.dockerMachineConfig.then(v => v?.Driver.Memory ?? 0);
  }

  /**
   * Ensure that Hyperkit and associated binaries have the correct owner / is
   * set as suid.
   */
  protected async ensureHyperkitOwnership() {
    const commands = [];
    // Check that the hyperkit driver is owned by root
    const { driver: driverExecutable } = this.hyperkitArgs;
    const { uid, mode } = await fs.promises.stat(driverExecutable);

    if (uid !== 0) {
      commands.push(`chown root "${ driverExecutable }"`);
    }
    if ((mode & 0o4000) === 0) {
      commands.push(`chmod u+s "${ driverExecutable }"`);
    }

    // Check that the hyperkit binary is in the 'admin' group
    const hyperkitExecutable = resources.executable('hyperkit');
    const { gid: hyperkitGid } = await fs.promises.stat(hyperkitExecutable);

    if (hyperkitGid !== adminGroup) {
      commands.push(`chown :admin "${ hyperkitExecutable }"`);
    }

    if (commands.length > 0) {
      const command = `sh -c '${ commands.join(' && ') }'`;
      const options = { name: Electron.app.name };

      console.log(command);
      await new Promise<void>((resolve, reject) => {
        sudo(command, options, (error, stdout, stderr) => {
          return error ? reject(error) : resolve();
        });
      });
    }
  }

  protected get hyperkitArgs(): { driver: string, defaultArgs: string[] } {
    return {
      driver:      resources.executable('docker-machine-driver-hyperkit'),
      defaultArgs: ['--storage-path', path.join(paths.state(), 'driver')],
    };
  }

  /**
   * Run docker-machine-hyperkit with the given arguments
   * @param args Arguments to pass to hyperkit
   */
  protected async hyperkit(...args: string[]): Promise<void> {
    const { driver, defaultArgs } = this.hyperkitArgs;
    const finalArgs = defaultArgs.concat(args);

    console.log(JSON.stringify([driver].concat(finalArgs)));
    await childProcess.spawnFile(driver, finalArgs,
      { stdio: ['inherit', Logging.k8s.stream, Logging.k8s.stream] });
  }

  /**
   * Run docker-machine-hyperkit with the given arguments, and return the result.
   * @param args Arguments to pass to hyperkit.
   * @returns Standard output of the process.
   */
  protected async hyperkitWithCapture(...args: string[]): Promise<string> {
    const { driver, defaultArgs } = this.hyperkitArgs;
    const finalArgs = defaultArgs.concat(args);

    console.log(JSON.stringify([driver].concat(finalArgs)));
    const { stdout } = await childProcess.spawnFile(driver, finalArgs,
      { stdio: ['inherit', 'pipe', Logging.k8s.stream] });

    return stdout;
  }

  protected get imageFile() {
    return resources.get(os.platform(), 'boot2tcl-1.1.1.iso');
  }

  /** Get the IPv4 address of the VM, assuming it's already up */
  get ipAddress(): Promise<string | undefined> {
    return (async() => {
      const { driver, defaultArgs } = this.hyperkitArgs;
      const args = defaultArgs.concat(['ip']);
      const result = await childProcess.spawnFile(driver, args, { stdio: 'pipe' });
      const address = result.stdout.trim();

      if (/^[0-9.]+$/.test(address)) {
        return address;
      }

      return undefined;
    })();
  }

  protected get vmState(): Promise<DockerMachineDriverState> {
    return (async() => {
      const { driver, defaultArgs } = this.hyperkitArgs;
      const args = defaultArgs.concat(['status']);
      const { stdout } = await childProcess.spawnFile(driver, args, { stdio: ['ignore', 'pipe', 'inherit'] });

      switch (stdout.trim()) {
      case 'Does not exist':
      case 'Not found':
        return DockerMachineDriverState.Missing;
      case 'Stopped':
      case 'Paused':
      case 'Saved':
        return DockerMachineDriverState.Stopped;
      case 'Running':
        return DockerMachineDriverState.Running;
      default:
        return DockerMachineDriverState.Error;
      }
    })();
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

  getBackendInvalidReason(): Promise<K8s.KubernetesError | null> {
    return Promise.resolve(null);
  }

  async start(config: Settings['kubernetes']): Promise<void> {
    const desiredVersion = await this.desiredVersion;
    const desiredPort = config.port;

    this.cfg = config;
    this.setState(K8s.State.STARTING);
    this.currentAction = Action.STARTING;
    try {
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

      await Promise.all([
        this.ensureHyperkitOwnership(),
        this.k3sHelper.ensureK3sImages(desiredVersion),
      ]);

      // We have no good estimate for the rest of the steps, go indeterminate.
      timers.clearInterval(this.progressInterval);
      this.progressInterval = undefined;
      this.setProgress(Progress.INDETERMINATE, 'Starting Kubernetes');

      // If we were previously running, stop it now.
      this.process?.kill('SIGTERM');

      // Start the VM
      if ((await this.hyperkitWithCapture('status')).trim() !== 'Running') {
        await this.hyperkit(
          'start',
          '--iso-url', this.imageFile,
          '--cpus', `${ this.cfg.numberCPUs }`,
          '--memory', `${ this.cfg.memoryInGB * 1024 }`,
          '--hyperkit', resources.executable('hyperkit'),
        );
      }

      // Copy the k3s files over
      const cacheDir = '/home/docker/k3s-cache';
      const filesToCopy: Record<string, string> = {
        ...Object.fromEntries(this.k3sHelper.filenames.map(filename => [
          path.join(paths.cache(), 'k3s', desiredVersion, filename),
          `${ cacheDir }/${ desiredVersion }/${ filename }`])),
        [resources.get(path.join(os.platform(), 'run-k3s'))]:    `${ cacheDir }/run-k3s`,
        [resources.get(path.join(os.platform(), 'kubeconfig'))]: `${ cacheDir }/kubeconfig`,
      };

      await this.hyperkit('ssh', '--', 'mkdir', '-p', `${ cacheDir }/${ desiredVersion }`);
      await Promise.all(Object.entries(filesToCopy).map(
        ([src, dest]) => this.hyperkit('cp', src, `:${ dest }`)));

      // Ensure that the k3s binary is executable.
      await this.hyperkit('ssh', '--', 'chmod', 'a+x',
        `${ cacheDir }/${ desiredVersion }/k3s`,
        `${ cacheDir }/run-k3s`,
        `${ cacheDir }/kubeconfig`);
      // Run run-k3s with NORUN, to set up the environment.
      await this.hyperkit('ssh', '--',
        'sudo', 'NORUN=1', `CACHE_DIR=${ cacheDir }`, `${ cacheDir }/run-k3s`, desiredVersion);

      // Check if we are doing an upgrade / downgrade
      switch (semver.compare(this.activeVersion || desiredVersion, desiredVersion)) {
      case -1:
      // Upgrading; nothing required.
        break;
      case 0:
      // Same version; nothing required.
        break;
      case 1:
      // Downgrading; need to delete data.
        await this.hyperkit('ssh', '--', 'sudo rm -rf /var/lib/rancher/k3s/server/db');
        break;
      }

      // Actually run K3s
      this.process = childProcess.spawn(
        resources.executable('docker-machine-driver-hyperkit'),
        ['--storage-path', path.join(paths.state(), 'driver'),
          'ssh', '--', 'sudo',
          '/usr/local/bin/k3s', 'server',
          '--https-listen-port', desiredPort.toString()
        ],
        { stdio: ['ignore', await Logging.k3s.fdStream, await Logging.k3s.fdStream] }
      );
      this.process.on('exit', async(status, signal) => {
        if ([0, null].includes(status) && ['SIGTERM', null].includes(signal)) {
          console.log(`K3s exited gracefully.`);
          await this.stop();
          this.process = null;
        } else {
          console.log(`K3s exited with status ${ status } signal ${ signal }`);
          await this.stop();
          this.process = null;
          this.setState(K8s.State.ERROR);
          this.setProgress(Progress.EMPTY);
        }
      });

      await this.k3sHelper.waitForServerReady(() => this.ipAddress, desiredPort);
      await this.k3sHelper.updateKubeconfig(
        () => this.hyperkitWithCapture('ssh', '--', 'sudo', `${ cacheDir }/kubeconfig`));
      this.setState(K8s.State.STARTED);
      this.setProgress(Progress.DONE);
      this.client = new K8s.Client();
      await this.client.waitForServiceWatcher();
      this.client.on('service-changed', (services) => {
        this.emit('service-changed', services);
      });
      this.activeVersion = desiredVersion;
      if (this.currentPort !== desiredPort) {
        this.currentPort = desiredPort;
        this.emit('current-port-changed', this.currentPort);
      }
      // Trigger kuberlr to ensure there's a compatible version of kubectl in place for the users
      // rancher-desktop mostly uses the K8s API instead of kubectl, so we need to invoke kubectl
      // to nudge kuberlr
      await childProcess.spawnFile(resources.executable('kubectl'), ['cluster-info'],
        { stdio: ['inherit', Logging.k8s.stream, Logging.k8s.stream] });
    } finally {
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
      await this.ensureHyperkitOwnership();
      this.process?.kill('SIGTERM');
      if (await this.vmState === DockerMachineDriverState.Running) {
        await this.hyperkit('stop');
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
    try {
      await this.stop();
      this.setProgress(Progress.INDETERMINATE, 'Deleting Kubernetes VM');
      await this.hyperkit('delete');
    } catch (ex) {
      this.setState(K8s.State.ERROR);
      this.setProgress(Progress.EMPTY);
      throw ex;
    }
    this.cfg = undefined;
    this.setProgress(Progress.DONE);
  }

  async reset(config: Settings['kubernetes']): Promise<void> {
    // For K3s, doing a full reset is fast enough.
    await this.del();
    await this.start(config);
  }

  async factoryReset(): Promise<void> {
    await this.del();
    await Promise.all([paths.cache(), paths.state()].map(p => fs.promises.rmdir(p, { recursive: true })));
  }

  listServices(namespace?: string): K8s.ServiceEntry[] {
    return this.client?.listServices(namespace) || [];
  }

  async isServiceReady(namespace: string, service: string): Promise<boolean> {
    return (await this.client?.isServiceReady(namespace, service)) || false;
  }

  requiresRestartReasons(): Promise<Record<string, [any, any] | []>> {
    return (async() => {
      const config = await this.dockerMachineConfig;
      const results: Record<string, [any, any] | []> = {};
      const cmp = (key: string, actual: number, desired: number) => {
        results[key] = actual === desired ? [] : [actual, desired];
      };

      if (!config || !this.cfg) {
        return {}; // No need to restart if nothing exists
      }
      cmp('cpu', config.Driver.CPU, this.cfg.numberCPUs);
      cmp('memory', config.Driver.Memory / 1024, this.cfg.memoryInGB);
      cmp('port', this.currentPort, this.cfg.port);

      return results;
    })();
  }

  async forwardPort(namespace: string, service: string, port: number): Promise<number | undefined> {
    return await this.client?.forwardPort(namespace, service, port);
  }

  async cancelForward(namespace: string, service: string, port: number): Promise<void> {
    await this.client?.cancelForwardPort(namespace, service, port);
  }
}
