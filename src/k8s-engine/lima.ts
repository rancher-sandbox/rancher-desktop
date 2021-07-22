// Kubernetes backend for macOS, based on Lima.

import { Console } from 'console';
import events from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import timers from 'timers';
import util from 'util';

import deepmerge from 'deepmerge';
import XDGAppPaths from 'xdg-app-paths';
import yaml from 'yaml';

import { Settings } from '@/config/settings';
import * as childProcess from '@/utils/childProcess';
import Logging from '@/utils/logging';
import resources from '@/resources';
import DEFAULT_CONFIG from '@/assets/lima-config.yaml';
import K3sHelper from './k3sHelper';
import * as K8s from './k8s';

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

/**
 * Lima configuration
 */
type LimaConfiguration = {
  arch?: 'x86_64' | 'aarch64';
  images: {
    location: string;
    arch?: 'x86_64';
    digest?: string;
  }[];
  cpus?: number;
  memory?: number;
  disk?: number;
  mounts?: {
    location: string;
    writable?: boolean;
  }[];
  ssh: {
    localPort: number;
    loadDotSSHPubKeys?: boolean;
  }
  firmware?: {
    legacyBIOS?: boolean;
  }
  video?: {
    display?: string;
  }
  provision?: {
    mode: 'system' | 'user';
    script: string;
  }[]
  containerd?: {
    system?: boolean;
    user?: boolean;
  }
  probes?: {
    mode: 'readiness';
    description: string;
    script: string;
    hint: string;
  }[];
}

/**
 * One entry from `limactl list --json`
 */
interface LimaListResult {
  name: string;
  status: 'Broken' | 'Stopped' | 'Running';
  dir: string;
  arch: 'x86_64' | 'aarch64';
  sshLocalPort?: number;
  hostAgentPID?: number;
  qemuPID?: number;
  errors?: string[];
}

const console = new Console(Logging.lima.stream);
const paths = XDGAppPaths('rancher-desktop');
const MACHINE_NAME = 'rancher-desktop';
const LIMA_HOME = path.join(paths.state(), 'lima');
const CONFIG_PATH = path.join(LIMA_HOME, '_config', `${ MACHINE_NAME }.yaml`);

function defined<T>(input: T | null | undefined): input is T {
  return input !== null && typeof input !== 'undefined';
}

export default class LimaBackend extends events.EventEmitter implements K8s.KubernetesBackend {
  constructor() {
    super();
    this.k3sHelper.on('versions-updated', () => this.emit('versions-updated'));
    this.k3sHelper.initialize();
  }

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

  get backend(): 'lima' {
    return 'lima';
  }

  get version(): string {
    return this.activeVersion;
  }

  get port(): number {
    return this.currentPort;
  }

  get availableVersions(): Promise<string[]> {
    return this.k3sHelper.availableVersions;
  }

  get cpus(): Promise<number> {
    return (async() => {
      return (await this.currentConfig)?.cpus || 0;
    })();
  }

  get memory(): Promise<number> {
    return (async() => {
      return Math.round(((await this.currentConfig)?.memory || 0) / 1024 / 1024 / 1024);
    })();
  }

  /** Get the IPv4 address of the VM, assuming it's already up */
  get ipAddress(): Promise<string | undefined> {
    return (async() => {
      // Get the routing map structure
      const state = await this.limaWithCapture('shell', '--workdir=.', MACHINE_NAME, 'cat', '/proc/net/fib_trie');

      // We look for the IP address by:
      // 1. Convert the structure (text) into lines.
      // 2. Look for lines followed by "/32 host LOCAL".
      //    This gives interface addresses.
      const lines = state
        .split(/\r?\n+/)
        .filter((_, i, array) => (array[i + 1] || '').includes('/32 host LOCAL'));
        // 3. Filter for lines with the shortest prefix; this is needed to reject
        //    the CNI interfaces.
      const lengths: [number, string][] = lines.map(line => [line.length - line.trimStart().length, line]);
      const minLength = Math.min(...lengths.map(([length]) => length));
      // 4. Drop the tree formatting ("    |-- ").  The result are IP addresses.
      // 5. Reject loopback addresses.
      const addresses = lengths
        .filter(([length]) => length === minLength)
        .map(([_, address]) => address.replace(/^\s+\|--/, '').trim())
        .filter(address => !address.startsWith('127.'));

      // Assume the first address is what we want, as the VM only has one
      // (non-loopback, non-CNI) interface.
      return addresses[0];
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

  protected async generateConfig() {
    const defaultConfig: LimaConfiguration = DEFAULT_CONFIG;
    const config = deepmerge(defaultConfig, {
      images:     [{
        location: resources.get(os.platform(), 'alpline-lima-v0.1.0-std-3.13.5.iso'),
        arch:     'x86_64',
      }],
      cpus:       this.cfg?.numberCPUs || 4,
      memory:     (this.cfg?.memoryInGB || 4) * 1024 * 1024 * 1024,
      mounts:     [{ location: path.join(paths.cache(), 'k3s'), writable: false }],
    });

    await fs.promises.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
    await fs.promises.writeFile(CONFIG_PATH, yaml.stringify(config));
  }

  protected get currentConfig(): Promise<LimaConfiguration | undefined> {
    return (async() => {
      try {
        const configPath = path.join(LIMA_HOME, MACHINE_NAME, 'lima.yaml');
        const configRaw = await fs.promises.readFile(configPath, 'utf-8');

        return yaml.parse(configRaw) as LimaConfiguration;
      } catch (ex) {
        if (ex.code === 'ENOENT') {
          return undefined;
        }
        throw ex;
      }
    })();
  }

  protected get limactl() {
    return resources.executable('lima/bin/limactl');
  }

  protected get limaEnv() {
    const binDir = resources.get(os.platform(), 'lima', 'bin');
    const pathList = (process.env.PATH || '').split(path.delimiter);
    const newPath = [binDir].concat(...pathList).filter(x => x);

    return {
      ...process.env, LIMA_HOME, PATH: newPath.join(path.delimiter)
    };
  }

  protected async lima(...args: string[]): Promise<void> {
    const stream = await Logging.lima.fdStream;

    await childProcess.spawnFile(this.limactl, args,
      { env: this.limaEnv, stdio: ['ignore', stream, stream] });
  }

  protected async limaWithCapture(...args: string[]): Promise<string> {
    const stream = await Logging.lima.fdStream;
    const { stdout } = await childProcess.spawnFile(this.limactl, args,
      { env: this.limaEnv, stdio: ['ignore', 'pipe', stream] });

    return stdout;
  }

  protected async ssh(...args: string[]): Promise<void> {
    await this.lima('shell', '--workdir=.', MACHINE_NAME, ...args);
  }

  protected get status(): Promise<LimaListResult|undefined> {
    return (async() => {
      const text = await this.limaWithCapture('list', '--json');
      const lines = text.split(/\r?\n/).filter(x => x.trim());

      try {
        const entries = lines.map(line => JSON.parse(line) as LimaListResult);

        return entries.find(entry => entry.name === MACHINE_NAME);
      } catch (ex) {
        console.error('Could not parse status:', text);
        throw ex;
      }
    })();
  }

  protected get isRegistered(): Promise<boolean> {
    return this.status.then(defined);
  }

  async start(config: { version: string; memoryInGB: number; numberCPUs: number; port: number; }): Promise<void> {
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
        this.k3sHelper.ensureK3sImages(desiredVersion),
        this.generateConfig(),
      ]);

      // We have no good estimate for the rest of the steps, go indeterminate.
      timers.clearInterval(this.progressInterval);
      this.progressInterval = undefined;
      this.setProgress(Progress.INDETERMINATE, 'Starting Kubernetes');

      // If we were previously running, stop it now.
      this.process?.kill('SIGTERM');

      // Start the VM; if it's already running, this does nothing.
      await this.lima('start', '--tty=false', await this.isRegistered ? MACHINE_NAME : CONFIG_PATH);

      // Copy in the helpers and make them executable.  Note that we can't run the commands in
      // parallel, as that causes issues with the SSH control socket being closed.
      await this.ssh('mkdir', '-p', 'bin');
      await this.lima('copy', resources.get(os.platform(), 'run-k3s'), `${ MACHINE_NAME }:bin/run-k3s`);
      await this.ssh('chmod', 'a+x', 'bin/run-k3s');

      // Run run-k3s with NORUN, to set up the environment.
      await fs.promises.chmod(path.join(paths.cache(), 'k3s', desiredVersion, 'k3s'), 0o755);
      await this.ssh('sudo', 'NORUN=1', `CACHE_DIR=${ path.join(paths.cache(), 'k3s') }`, 'bin/run-k3s', desiredVersion);

      // Actually run K3s
      const logStream = await Logging.k3s.fdStream;

      this.process = childProcess.spawn(
        this.limactl,
        ['shell', '--workdir=.', MACHINE_NAME,
          'sudo', '/usr/local/bin/k3s', 'server',
          '--https-listen-port', desiredPort.toString(),
        ],
        { env: this.limaEnv, stdio: ['ignore', logStream, logStream] });

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

      await this.k3sHelper.waitForServerReady(() => Promise.resolve('127.0.0.1'), desiredPort);
      while (true) {
        try {
          await childProcess.spawnFile(this.limactl,
            ['shell', '--workdir=.', MACHINE_NAME, 'ls', '/etc/rancher/k3s/k3s.yaml'],
            { env: this.limaEnv, stdio: 'ignore' });
          break;
        } catch (ex) {
          console.log('Could not read k3s.yaml; retrying...');
          await util.promisify(setTimeout)(1_000);
        }
      }
      console.debug('/etc/rancher/k3s/k3s.yaml is ready.');
      await this.k3sHelper.updateKubeconfig(
        () => this.limaWithCapture('shell', '--workdir=.', MACHINE_NAME, 'sudo', 'cat', '/etc/rancher/k3s/k3s.yaml'));
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
        { stdio: ['inherit', await Logging.k8s.fdStream, await Logging.k8s.fdStream] });
    } catch (err) {
      console.error('Error starting lima:', err);
      this.setState(K8s.State.ERROR);
      this.setProgress(Progress.EMPTY);
      throw err;
    } finally {
      this.currentAction = Action.NONE ;
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
      const status = await this.status;

      if (defined(status) && status.status === 'Running') {
        await this.lima('stop', MACHINE_NAME);
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
      if (defined(await this.status)) {
        await this.stop();
        this.setProgress(Progress.INDETERMINATE, 'Deleting Kubernetes VM');
        await this.lima('delete', MACHINE_NAME);
      }
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

  async requiresRestartReasons(): Promise<Record<string, [any, any] | []>> {
    const currentConfig = await this.currentConfig;

    const results: Record<string, [any, any] | []> = {};
    const cmp = (key: string, actual: number, desired: number) => {
      if (typeof actual === 'undefined') {
        results[key] = [];
      } else {
        results[key] = actual === desired ? [] : [actual, desired];
      }
    };

    if (!currentConfig || !this.cfg) {
      return {}; // No need to restart if nothing exists
    }
    const GiB = 1024 * 1024 * 1024;

    cmp('cpu', currentConfig.cpus || 4, this.cfg.numberCPUs);
    cmp('memory', Math.round((currentConfig.memory || 4 * GiB) / GiB), this.cfg.memoryInGB);
    console.log(`Checking port: ${ JSON.stringify({ current: this.currentPort, config: this.cfg.port }) }`);
    cmp('port', this.currentPort, this.cfg.port);

    return results;
  }

  listServices(namespace?: string): K8s.ServiceEntry[] {
    return this.client?.listServices(namespace) || [];
  }

  async isServiceReady(namespace: string, service: string): Promise<boolean> {
    return (await this.client?.isServiceReady(namespace, service)) || false;
  }

  forwardPort(namespace: string, service: string, port: number): Promise<number | undefined> {
    // Lima automatically forwards all the ports.
    return Promise.resolve(undefined);
  }

  cancelForward(namespace: string, service: string, port: number): Promise<void> {
    // Lima automatically forwards all the ports.
    return Promise.resolve();
  }
}
