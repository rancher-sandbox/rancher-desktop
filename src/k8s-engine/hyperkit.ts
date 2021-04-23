// Kubernetes backend for macOS, based on Hyperkit

import childProcess from 'child_process';
import events from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import stream from 'stream';
import timers from 'timers';
import util from 'util';

import fetch from 'node-fetch';
import XDGAppPaths from 'xdg-app-paths';

import { Settings } from '../config/settings';
import resources from '../resources';
import DownloadProgressListener from '../utils/DownloadProgressListener';
import * as K8s from './k8s';
import K3sHelper from './k3sHelper';

const paths = XDGAppPaths('rancher-desktop');

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
  constructor(cfg: Settings['kubernetes']) {
    super();
    this.cfg = cfg;
    this.k3sHelper.on('versions-updated', () => this.emit('versions-updated'));
    this.k3sHelper.initialize();
  }

  protected readonly MACHINE_NAME = 'default';

  protected cfg: Settings['kubernetes'];

  /** The version of Kubernetes currently running. */
  protected activeVersion = '';

  /** Helper object to manage available K3s versions. */
  protected k3sHelper = new K3sHelper();

  protected client: K8s.Client | null = null;

  /** Variable to keep track of the download progress for the distribution. */
  protected imageProgress = { current: 0, max: 0 };

  /** Interval handle to update the progress. */
  // The return type is odd because TypeScript is pulling in some of the DOM
  // definitions here, which has an incompatible setInterval/clearInterval.
  protected progressInterval: ReturnType<typeof timers.setInterval> | undefined;

  protected get imageUrl() {
    return 'https://github.com/rancher-sandbox/boot2tcl/releases/download/v1.0.0/boot2tcl.iso';
  }

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
   * Run docker-machine-hyperkit with the given arguments
   * @param args Arguments to pass to hyperkit
   */
  protected async hyperkit(...args: string[]): Promise<void> {
    const options: childProcess.SpawnOptions = { stdio: 'inherit' };
    const driver = resources.executable('docker-machine-driver-hyperkit');
    const defaultArgs = [
      '--storage-path', path.join(paths.state(), 'driver'),
    ];

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
    return path.join(paths.cache(), 'image.iso');
  }

  protected async ensureImage(): Promise<void> {
    try {
      await fs.promises.stat(this.imageFile);

      return;
    } catch (e) {
      if (e.code !== 'ENOENT') {
        throw e;
      }
    }

    await fs.promises.mkdir(paths.cache(), { recursive: true });
    const dir = await fs.promises.mkdtemp(path.join(paths.cache(), 'image-'));
    const outPath = path.join(dir, path.basename(this.imageFile));

    try {
      const response = await fetch(this.imageUrl);

      if (!response.ok) {
        throw new Error(`Failure downloading image: ${ response.statusText }`);
      }

      const progress = new DownloadProgressListener(this.imageProgress);
      const writeStream = fs.createWriteStream(outPath);

      this.imageProgress.max = parseInt(response.headers.get('Content-Length') || '0');
      await util.promisify(stream.pipeline)(response.body, progress, writeStream);
      await fs.promises.rename(outPath, this.imageFile);
    } finally {
      try {
        await fs.promises.unlink(outPath);
      } catch (e) {
        if (e.code !== 'ENOENT') {
          // Re-throwing exceptions is no worse than not catching it at all.
          // eslint-disable-next-line no-unsafe-finally
          throw e;
        }
      }
      await fs.promises.rmdir(dir);
    }
  }

  /** Get the IPv4 address of the VM, assuming it's already up */
  protected get ipAddress(): Promise<string> {
    return (async() => {
      const driver = resources.executable('docker-machine-driver-hyperkit');
      const args = [
        '--storage-path', path.join(paths.state(), 'driver'),
        'ssh', '--', 'ip', '-4', '-o', 'addr', 'show', 'dev', 'eth0'
      ];
      const result = await util.promisify(childProcess.execFile)(driver, args);
      const match = /\binet\s+([0-9.]+)\//.exec(result.stdout);

      if (match) {
        return match[1];
      }

      throw new Error(`Could not find address of VM: ${ result.stderr }`);
    })();
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

  async start(): Promise<void> {
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
        this.imageProgress,
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
      this.ensureImage(),
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
      '--volume', `${ path.join(paths.cache(), 'k3s') }:/k3s-cache:ro`,
      '--volume', `${ resources.get(os.platform()) }:/opt/rd`,
    );

    // Ensure that the k3s binary is executable.
    await this.hyperkit('ssh', '--', 'chmod', 'a+x', `/k3s-cache/${ desiredVersion }/k3s`);
    // Run run-k3s with NORUN, to set up the environment.
    await this.hyperkit('ssh', '--',
      'sudo', 'NORUN=1', 'CACHE_DIR=/k3s-cache', '/opt/rd/run-k3s', desiredVersion);

    // Actually run K3s
    this.process = childProcess.spawn(
      resources.executable('docker-machine-driver-hyperkit'),
      ['--storage-path', path.join(paths.state(), 'driver'),
        'ssh', '--', 'sudo',
        '/usr/local/bin/k3s', 'server'
      ],
      { stdio: 'inherit' }
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
        'ssh', '--', 'sudo', '/opt/rd/kubeconfig',
      );
    } catch (e) {
      console.error(e);
      console.error(e.stack);
      throw e;
    }

    this.setState(K8s.State.STARTED);
  }

  async stop(): Promise<number> {
    try {
      this.setState(K8s.State.STOPPING);
      this.process?.kill('SIGTERM');
      await this.hyperkit('stop');
      this.setState(K8s.State.STOPPED);
    } catch (ex) {
      this.setState(K8s.State.ERROR);
      throw ex;
    }

    return Promise.resolve(0);
  }

  async del(): Promise<number> {
    try {
      await this.stop();
      await this.hyperkit('delete');
    } catch (ex) {
      this.setState(K8s.State.ERROR);
      throw ex;
    }

    return Promise.resolve(0);
  }

  async reset(): Promise<void> {
    // For K3s, doing a full reset is fast enough.
    await this.del();
    await this.start();
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

      if (!config) {
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
