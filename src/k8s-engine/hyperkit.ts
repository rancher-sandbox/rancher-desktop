// Kubernetes backend for macOS, based on Hyperkit

import childProcess from 'child_process';
import { Console } from 'console';
import events from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import timers from 'timers';
import util from 'util';

import Electron from 'electron';
import fetch from 'node-fetch';
import XDGAppPaths from 'xdg-app-paths';
import { exec as sudo } from 'sudo-prompt';

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

  /** Helper object to manage available K3s versions. */
  protected k3sHelper = new K3sHelper();

  protected client: K8s.Client | null = null;

  /** Interval handle to update the progress. */
  // The return type is odd because TypeScript is pulling in some of the DOM
  // definitions here, which has an incompatible setInterval/clearInterval.
  protected progressInterval: ReturnType<typeof timers.setInterval> | undefined;

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

  protected process: childProcess.ChildProcess | null = null;

  get version(): string {
    return this.activeVersion;
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
    const options: childProcess.SpawnOptions = { stdio: 'inherit' };
    const { driver, defaultArgs } = this.hyperkitArgs;

    process.stderr.write(`\u001B[0;1m${ JSON.stringify([driver].concat(defaultArgs, args)) }\u001B[0m\n`);
    await new Promise<void>((resolve, reject) => {
      const child = childProcess.spawn(driver, defaultArgs.concat(args), options);

      child.on('error', reject);
      child.on('exit', (status, signal) => {
        if (status === 0 && signal === null) {
          return resolve();
        }
        const msg = status ? `status ${ status }` : `signal ${ signal }`;

        reject(new Error(`Could not launch hyperkit; exiting with ${ msg }`));
      });
    });
  }

  protected get imageFile() {
    return resources.get(os.platform(), 'boot2tcl-1.1.1.iso');
  }

  /** Get the IPv4 address of the VM, assuming it's already up */
  protected get ipAddress(): Promise<string> {
    return (async() => {
      const { driver, defaultArgs } = this.hyperkitArgs;
      const args = defaultArgs.concat(['ip']);
      const result = await util.promisify(childProcess.execFile)(driver, args);

      if (/^[0-9.]+$/.test(result.stdout.trim())) {
        return result.stdout.trim();
      }

      throw new Error(`Could not find address of VM: ${ result.stderr }`);
    })();
  }

  protected get vmState(): Promise<DockerMachineDriverState> {
    return (async() => {
      const { driver, defaultArgs } = this.hyperkitArgs;
      const args = defaultArgs.concat(['status']);
      const { stdout } = await util.promisify(childProcess.execFile)(driver, args);

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
    this.cfg = config;
    const desiredVersion = await this.desiredVersion;

    // Unconditionally stop, in case a previous run broke.
    await this.stop();

    this.setState(K8s.State.STARTING);
    if (this.progressInterval) {
      timers.clearInterval(this.progressInterval);
    }
    this.emit('progress', 0, 0);
    this.progressInterval = timers.setInterval(() => {
      const statuses = [
        this.k3sHelper.progress.checksum,
        this.k3sHelper.progress.exe,
        this.k3sHelper.progress.images,
      ];
      const sum = (key: 'current' | 'max') => {
        return statuses.reduce((v, c) => v + c[key], 0);
      };

      this.emit('progress', sum('current'), sum('max'));
    }, 250);

    await Promise.all([
      this.ensureHyperkitOwnership(),
      this.k3sHelper.ensureK3sImages(desiredVersion),
    ]);

    // We have no good estimate for the rest of the steps, go indeterminate.
    timers.clearInterval(this.progressInterval);
    this.progressInterval = undefined;
    this.emit('progress', 0, 0);

    // Start the VM
    await this.hyperkit(
      'start',
      '--iso-url', this.imageFile,
      '--cpus', `${ this.cfg.numberCPUs }`,
      '--memory', `${ this.cfg.memoryInGB * 1024 }`,
      '--hyperkit', resources.executable('hyperkit'),
    );

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

    // Actually run K3s
    this.process = childProcess.spawn(
      resources.executable('docker-machine-driver-hyperkit'),
      ['--storage-path', path.join(paths.state(), 'driver'),
        'ssh', '--', 'sudo',
        '/usr/local/bin/k3s', 'server'
      ],
      { stdio: ['ignore', await Logging.k3s.fdStream, await Logging.k3s.fdStream] }
    );
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
        const resp = await fetch(`http://${ await this.ipAddress }:6443`);

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

    try {
      await this.k3sHelper.updateKubeconfig(
        resources.executable('docker-machine-driver-hyperkit'),
        '--storage-path', path.join(paths.state(), 'driver'),
        'ssh', '--', 'sudo', `${ cacheDir }/kubeconfig`,
      );
    } catch (e) {
      console.error(e);
      console.error(e.stack);
      throw e;
    }
    this.setState(K8s.State.STARTED);
    this.client = new K8s.Client();
    await this.client.waitForServiceWatcher();
    this.client.on('service-changed', (services) => {
      this.emit('service-changed', services);
    });
  }

  async stop(): Promise<number> {
    try {
      this.setState(K8s.State.STOPPING);
      await this.ensureHyperkitOwnership();
      this.process?.kill('SIGTERM');
      if (await this.vmState === DockerMachineDriverState.Running) {
        await this.hyperkit('stop');
      }
      this.setState(K8s.State.STOPPED);
    } catch (ex) {
      this.setState(K8s.State.ERROR);
      throw ex;
    }

    return 0;
  }

  async del(): Promise<number> {
    try {
      await this.stop();
      await this.hyperkit('delete');
    } catch (ex) {
      this.setState(K8s.State.ERROR);
      throw ex;
    }
    this.cfg = undefined;

    return Promise.resolve(0);
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
