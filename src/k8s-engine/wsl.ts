// Kuberentes backend for Windows, based on WSL2 + k3s

import { Console } from 'console';
import crypto from 'crypto';
import events from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import stream from 'stream';
import timers from 'timers';
import util from 'util';

import semver from 'semver';

import INSTALL_K3S_SCRIPT from '@/assets/scripts/install-k3s';
import mainEvents from '@/main/mainEvents';
import * as childProcess from '@/utils/childProcess';
import Logging from '@/utils/logging';
import paths from '@/utils/paths';
import { Settings } from '@/config/settings';
import resources from '@/resources';
import * as K8s from './k8s';
import K3sHelper, { ShortVersion } from './k3sHelper';

const console = new Console(Logging.wsl.stream);
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

/**
 * A list of distributions in which we should never attempt to integrate with.
 */
const DISTRO_BLACKLIST = [
  'rancher-desktop', // That's ourselves
  'docker-desktop', // Not meant for interactive use
  'docker-desktop-data', // Not meant for interactive use
];

/** The version of the WSL distro we expect. */
const DISTRO_VERSION = '0.3';

export default class WSLBackend extends events.EventEmitter implements K8s.KubernetesBackend {
  constructor() {
    super();
    this.k3sHelper.on('versions-updated', () => this.emit('versions-updated'));
    this.k3sHelper.initialize();
  }

  protected get distroFile() {
    return resources.get(os.platform(), `distro-${ DISTRO_VERSION }.tar`);
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
  protected activeVersion: ShortVersion = '';

  /** The port the Kubernetes server is listening on (default 6443) */
  protected currentPort = 0;

  /** The port Kubernetes should listen on; this may not match reality if Kubernetes isn't up. */
  #desiredPort = 6443;

  /** Helper object to manage available K3s versions. */
  protected k3sHelper = new K3sHelper();

  /**
   * The current operation underway; used to avoid responding to state changes
   * when we're in the process of doing a different one.
   */
  protected currentAction: Action = Action.NONE;

  get backend(): 'wsl' {
    return 'wsl';
  }

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

  get version(): ShortVersion {
    return this.activeVersion;
  }

  get port(): number {
    return this.currentPort;
  }

  get availableVersions(): Promise<ShortVersion[]> {
    return this.k3sHelper.availableVersions;
  }

  get desiredVersion(): Promise<ShortVersion> {
    return (async() => {
      const availableVersions = await this.k3sHelper.availableVersions;
      let version = this.cfg?.version || availableVersions[0];

      if (!version) {
        throw new Error('No version available');
      }

      if (!availableVersions.includes(version)) {
        console.error(`Could not use saved version ${ version }, not in ${ availableVersions }`);
        version = availableVersions[0];
      }

      return version;
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

  get desiredPort() {
    return this.#desiredPort;
  }

  protected async registeredDistros({ runningOnly = false } = {}): Promise<string[]> {
    const args = ['--list', '--quiet'];

    if (runningOnly) {
      args.push('--running');
    }
    const { stdout } = await childProcess.spawnFile('wsl.exe', args, {
      encoding:    'utf16le',
      stdio:       ['ignore', 'pipe', await Logging.wsl.fdStream],
      windowsHide: true,
    });

    return stdout.split(/[\r\n]+/).map(x => x.trim()).filter(x => x);
  }

  protected async isDistroRegistered({ runningOnly = false } = {}): Promise<boolean> {
    const distros = await this.registeredDistros({ runningOnly });

    console.log(`Registered distributions: ${ distros }`);

    return distros.includes(INSTANCE_NAME);
  }

  protected async getDistroVersion(): Promise<string> {
    // ESLint doesn't realize we're doing inline shell scripts.
    // eslint-disable-next-line no-template-curly-in-string
    const script = '[ -e /etc/os-release ] && . /etc/os-release ; echo ${VERSION_ID:-0.1}';

    return (await this.captureCommand('/bin/sh', '-c', script)).trim();
  }

  /**
   * Ensure that the distribution has been installed into WSL2.
   */
  protected async ensureDistroRegistered(): Promise<void> {
    if (await this.isDistroRegistered()) {
      // k3s is already registered.
      return;
    }
    const args = ['--import', INSTANCE_NAME, paths.wslDistro, this.distroFile, '--version', '2'];

    await fs.promises.mkdir(paths.wslDistro, { recursive: true });
    await childProcess.spawnFile('wsl.exe', args, {
      encoding:    'utf16le',
      stdio:       ['ignore', await Logging.wsl.fdStream, await Logging.wsl.fdStream],
      windowsHide: true
    });

    if (!await this.isDistroRegistered()) {
      throw new Error(`Error registering WSL2 distribution`);
    }
  }

  /**
   * Convert a Windows path to a path in the WSL subsystem:
   * - Changes \s to /s
   * - Figures out what the /mnt/DRIVE-LETTER path should be
   */
  protected async wslify(windowsPath: string): Promise<string> {
    return (await this.captureCommand('wslpath', '-a', '-u', windowsPath)).trimEnd();
  }

  protected async killStaleProcesses() {
    await childProcess.spawnFile('wsl.exe', ['--terminate', INSTANCE_NAME],
      {
        stdio:       ['ignore', await Logging.wsl.fdStream, await Logging.wsl.fdStream],
        windowsHide: true
      });
  }

  /**
   * Copy a file from Windows to the WSL distribution.
   */
  protected async wslInstall(windowsPath: string, targetDirectory: string): Promise<void> {
    const wslSourcePath = await this.wslify(windowsPath);
    const basename = path.basename(windowsPath);
    // Don't use `path.join` or the backslashes will come back.
    const targetFile = `${ targetDirectory }/${ basename }`;

    console.log(`Installing ${ windowsPath } as ${ wslSourcePath } into ${ targetFile } ...`);
    try {
      const stdout = await this.captureCommand('cp', wslSourcePath, targetFile);

      if (stdout) {
        console.log(`cp ${ windowsPath } as ${ wslSourcePath } to ${ targetFile }: ${ stdout }`);
      }
    } catch (err) {
      console.log(`Error trying to cp ${ windowsPath } as ${ wslSourcePath } to ${ targetFile }: ${ err }`);
      throw err;
    }
  }

  /**
   * Persist the given version into the WSL disk, so we can look it up later.
   */
  protected async persistVersion(version: ShortVersion): Promise<void> {
    const filepath = '/var/lib/rancher/k3s/version';

    await this.execCommand('/bin/sh', '-c', `echo '${ version }' > ${ filepath }`);
  }

  /**
   * Look up the previously presisted version.
   */
  protected async getPersistedVersion(): Promise<ShortVersion | undefined> {
    const filepath = '/var/lib/rancher/k3s/version';

    try {
      return (await this.captureCommand('/bin/cat', filepath)).trim();
    } catch (ex) {
      return undefined;
    }
  }

  protected async deleteIncompatibleData(desiredVersion: string) {
    const existingVersion = await this.getPersistedVersion();

    if (!existingVersion) {
      return;
    }
    if (semver.gt(existingVersion, desiredVersion)) {
      await this.k3sHelper.deleteKubeState((...args) => this.execCommand(...args));
    }
  }

  /**
   * Install K3s into the VM for execution.
   * @param version The version to install.
   */
  protected async installK3s(version: ShortVersion) {
    const fullVersion = this.k3sHelper.fullVersion(version);
    const workdir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rd-k3s-install-'));

    try {
      const scriptPath = path.join(workdir, 'install-k3s');
      const wslScriptPath = await this.wslify(scriptPath);

      await fs.promises.writeFile(scriptPath, INSTALL_K3S_SCRIPT.replace(/\r/g, ''), { encoding: 'utf-8' });
      await this.execCommand('chmod', 'a+x', wslScriptPath);
      await this.execCommand(wslScriptPath, fullVersion, await this.wslify(path.join(paths.cache, 'k3s')));
    } finally {
      await fs.promises.rm(workdir, { recursive: true });
    }
  }

  /**
   * On Windows Trivy is run via WSL as there's no native port.
   * Ensure that all relevant files are in the wsl mount, not the windows one.
   */
  protected async installTrivy() {
    // download-resources.sh installed trivy into the resources area
    // This function moves it and the trivy.tpl into /usr/local/bin/ and /var/lib/
    // respectively so when trivy is invoked to run through wsl, it runs faster.

    const trivyExecPath = await resources.get('linux', 'bin', 'trivy');
    const trivyPath = await resources.get('templates', 'trivy.tpl');

    await this.execCommand('mkdir', '-p', '/var/local/bin');
    await this.wslInstall(trivyExecPath, '/usr/local/bin');
    await this.execCommand('mkdir', '-p', '/var/lib');
    await this.wslInstall(trivyPath, '/var/lib/');
  }

  /**
   * execCommand runs the given command in the K3s WSL environment.
   * @param command The command to execute.
   */
  protected async execCommand(...command: string[]): Promise<void> {
    const args = ['--distribution', INSTANCE_NAME, '--exec'].concat(command);

    try {
      await childProcess.spawnFile('wsl.exe', args,
        {
          stdio:       ['ignore', await Logging.wsl.fdStream, await Logging.wsl.fdStream],
          windowsHide: true
        });
    } catch (ex) {
      console.error(`WSL failed to execute ${ command.join(' ') }`);
      throw ex;
    }
  }

  /**
   * captureCommand runs the given command in the K3s WSL environment and returns
   * the standard output.
   * @param command The command to execute.
   * @returns The output of the command.
   */
  protected async captureCommand(...command: string[]): Promise<string> {
    const args = ['--distribution', INSTANCE_NAME, '--exec'].concat(command);

    try {
      const { stdout } = await childProcess.spawnFile('wsl.exe', args,
        {
          stdio:       ['ignore', 'pipe', await Logging.wsl.fdStream],
          windowsHide: true
        });

      return stdout;
    } catch (ex) {
      console.error(`WSL failed to execute ${ command.join(' ') }`);
      throw ex;
    }
  }

  /** Get the IPv4 address of the VM, assuming it's already up. */
  get ipAddress(): Promise<string | undefined> {
    return (async() => {
      // Get the routing map structure
      const state = await this.captureCommand('cat', '/proc/net/fib_trie');

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

      // Assume the first address is what we want, as the WSL VM only has one
      // (non-loopback, non-CNI) interface.
      return addresses[0];
    })();
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

  /**
   * Check that the WSL distribution version is acceptable.  Throws an error
   * if the distro needs to be updated.
   */
  protected async checkDistroVersion() {
    if (await this.isDistroRegistered()) {
      let existingVersion = await this.getDistroVersion();

      if (!semver.valid(existingVersion, true)) {
        existingVersion += '.0';
      }
      let desiredVersion = DISTRO_VERSION;

      if (!semver.valid(desiredVersion, true)) {
        desiredVersion += '.0';
      }
      if (semver.lt(existingVersion, desiredVersion, true)) {
        console.log('Distro is obsolete, needs to be wiped.');
        const message = `
          Your Rancher Desktop WSL distribution is obsolete; please reset
          Kubernetes and container images to continue.
        `.replace(/[ \t]{2,}/g, '');

        throw new K8s.KubernetesError('WSL Distribution Obsolete', message);
      }
    }
  }

  async start(config: Settings['kubernetes']): Promise<void> {
    this.#desiredPort = config.port;
    this.cfg = config;
    this.currentAction = Action.STARTING;
    try {
      this.setState(K8s.State.STARTING);
      await this.checkDistroVersion();

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

      if (this.currentAction !== Action.STARTING) {
        // User aborted before we finished
        return;
      }
      await this.installTrivy();
      // We have no good estimate for the rest of the steps, go indeterminate.
      timers.clearInterval(this.progressInterval);
      this.progressInterval = undefined;
      this.setProgress(Progress.INDETERMINATE, 'Starting Kubernetes');

      // If we were previously running, stop it now.
      this.process?.kill('SIGTERM');
      await this.killStaleProcesses();

      // Temporary workaround: ensure root is mounted as shared -- this will be done later
      await childProcess.spawnFile(
        'wsl.exe',
        ['--user', 'root', '--distribution', INSTANCE_NAME, 'mount', '--make-shared', '/'],
        {
          stdio:       ['ignore', await Logging.wsl.fdStream, await Logging.wsl.fdStream],
          windowsHide: true,
        });

      // Create /etc/machine-id if it does not already exist
      const machineID = (await util.promisify(crypto.randomBytes)(16)).toString('hex');

      await this.execCommand('/bin/sh', '-c', `echo '${ machineID }' > /tmp/machine-id`);
      await this.execCommand('/bin/mv', '-n', '/tmp/machine-id', '/etc/machine-id');
      await this.execCommand('/bin/rm', '-f', '/tmp/machine-id');

      await this.installCACerts();
      await this.deleteIncompatibleData(desiredVersion);
      await this.installK3s(desiredVersion);
      await this.persistVersion(desiredVersion);

      // Actually run K3s
      const args = ['--distribution', INSTANCE_NAME, '--exec', '/usr/local/bin/k3s', 'server',
        '--https-listen-port', this.#desiredPort.toString()];
      const options: childProcess.SpawnOptions = {
        env: {
          ...process.env,
          WSLENV:        `${ process.env.WSLENV }:IPTABLES_MODE`,
          IPTABLES_MODE: 'legacy',
        },
        stdio:       ['ignore', await Logging.k3s.fdStream, await Logging.k3s.fdStream],
        windowsHide: true,
      };

      if (this.currentAction !== Action.STARTING) {
        // User aborted
        return;
      }

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

      await this.k3sHelper.waitForServerReady(() => this.ipAddress, this.#desiredPort);
      await this.k3sHelper.updateKubeconfig(
        async() => await this.captureCommand(await this.getWSLHelperPath(), 'k3s', 'kubeconfig'));

      this.client = new K8s.Client();
      await this.client.waitForServiceWatcher();
      this.client.on('service-changed', (services) => {
        this.emit('service-changed', services);
      });
      this.activeVersion = desiredVersion;
      this.currentPort = this.#desiredPort;
      this.emit('current-port-changed', this.currentPort);

      // Trigger kuberlr to ensure there's a compatible version of kubectl in place
      await childProcess.spawnFile(resources.executable('kubectl'), ['config', 'current-context'],
        { stdio: ['inherit', Logging.k8s.stream, Logging.k8s.stream] });
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

  protected async installCACerts(): Promise<void> {
    const certs: (string|Buffer)[] = await new Promise((resolve) => {
      mainEvents.once('cert-ca-certificates', resolve);
      mainEvents.emit('cert-get-ca-certificates');
    });

    const workdir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rd-ca-'));

    try {
      await this.execCommand('/bin/sh', '-c', 'rm -f /usr/local/share/ca-certificates/rd-*.crt');
      // Unlike the Lima backends, we can freely copy files in parallel into the
      // WSL distro, so we don't require the use of tar here.
      await Promise.all(certs.map(async(cert, index) => {
        const filename = `rd-${ index }.crt`;

        await util.promisify(stream.pipeline)(
          stream.Readable.from(cert),
          fs.createWriteStream(path.join(workdir, filename), { mode: 0o600 }),
        );
        await this.execCommand(
          'cp',
          await this.wslify(path.join(workdir, filename)),
          '/usr/local/share/ca-certificates/');
      }));
    } finally {
      await fs.promises.rmdir(workdir, { recursive: true });
    }
    await this.execCommand('/usr/sbin/update-ca-certificates');
  }

  async stop(): Promise<void> {
    // When we manually call stop, the subprocess will terminate, which will
    // cause stop to get called again.  Prevent the re-entrancy.
    // If we're in the middle of starting, also ignore the call to stop (from
    // the process terminating), as we do not want to shut down the VM in that
    // case.
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
    if (await this.isDistroRegistered()) {
      await childProcess.spawnFile('wsl.exe', ['--unregister', INSTANCE_NAME], {
        stdio:       ['ignore', await Logging.wsl.fdStream, await Logging.wsl.fdStream],
        windowsHide: true,
      });
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
    if (await this.isDistroRegistered()) {
      await childProcess.spawnFile('wsl.exe', ['--unregister', INSTANCE_NAME], {
        stdio:       ['ignore', await Logging.wsl.fdStream, await Logging.wsl.fdStream],
        windowsHide: true,
      });
    }
    await Promise.all([paths.cache, paths.config].map(
      dir => fs.promises.rm(dir, { recursive: true })));

    try {
      await fs.promises.rmdir(paths.logs, { recursive: true });
    } catch (error) {
      // On Windows, we will probably fail to delete the directory as the log
      // files are held open; we should ignore that error.
      if (error.code !== 'ENOTEMPTY') {
        throw error;
      }
    }
  }

  listServices(namespace?: string): K8s.ServiceEntry[] {
    return this.client?.listServices(namespace) || [];
  }

  async isServiceReady(namespace: string, service: string): Promise<boolean> {
    return (await this.client?.isServiceReady(namespace, service)) || false;
  }

  requiresRestartReasons(): Promise<Record<string, [any, any] | []>> {
    if (this.currentAction !== Action.NONE || this.internalState === K8s.State.ERROR) {
      // If we're in the middle of starting or stopping, we don't need to restart.
      // If we're in an error state, differences between current and desired could be meaningless
      return Promise.resolve({});
    }

    return new Promise((resolve) => {
      const results: Record<string, [any, any] | []> = {};
      const cmp = (key: string, actual: number, desired: number) => {
        results[key] = actual === desired ? [] : [actual, desired];
      };

      if (!this.cfg) {
        resolve({}); // No need to restart if nothing exists
      }
      cmp('port', this.currentPort, this.cfg?.port ?? this.currentPort);
      resolve(results);
    });
  }

  get portForwarder() {
    return this;
  }

  async forwardPort(namespace: string, service: string, port: number | string): Promise<number | undefined> {
    return await this.client?.forwardPort(namespace, service, port);
  }

  async cancelForward(namespace: string, service: string, port: number | string): Promise<void> {
    await this.client?.cancelForwardPort(namespace, service, port);
  }

  /**
   * Return the Linux path to the WSL helper executable.
   */
  protected async getWSLHelperPath(): Promise<string> {
    // We need to get the Linux path to our helper executable; it is easier to
    // just get WSL to do the transformation for us.
    const { stdout } = await childProcess.spawnFile(
      'wsl.exe', ['--distribution', INSTANCE_NAME, '--exec', 'printenv', 'EXE_PATH'], {
        env: {
          ...process.env,
          EXE_PATH: resources.get('linux', 'bin', 'wsl-helper'),
          WSLENV:   `${ process.env.WSLENV }:EXE_PATH/up`,
        },
        stdio: ['ignore', 'pipe', await Logging.wsl.fdStream],
      });

    return stdout.trim();
  }

  async listIntegrations(): Promise<Record<string, boolean | string>> {
    const result: Record<string, boolean | string> = {};

    const executable = await this.getWSLHelperPath();

    for (const distro of await this.registeredDistros()) {
      if (DISTRO_BLACKLIST.includes(distro)) {
        continue;
      }

      try {
        const args = ['--distribution', distro, '--exec', executable, 'kubeconfig', '--show'];
        const kubeconfigPath = await this.k3sHelper.findKubeConfigToUpdate('rancher-desktop');
        const { stdout } = await childProcess.spawnFile('wsl.exe', args, {
          env: {
            ...process.env,
            KUBECONFIG: kubeconfigPath,
            WSLENV:     `${ process.env.WSLENV }:KUBECONFIG/up`,
          },
          stdio: ['ignore', 'pipe', await Logging.wsl.fdStream],
        });

        if (['true', 'false'].includes(stdout.trim())) {
          result[distro] = stdout.trim() === 'true';
        } else {
          result[distro] = stdout.trim();
        }
      } catch (error) {
        result[distro] = error.toString();
      }
    }

    return result;
  }

  listIntegrationWarnings(): void {
    // No implementation warnings available.
  }

  async setIntegration(distro: string, state: boolean): Promise<string | undefined> {
    if (!(await this.registeredDistros()).includes(distro)) {
      console.error(`Cannot integrate with unregistred distro ${ distro }`);

      return 'Unknown distribution';
    }
    const executable = await this.getWSLHelperPath();
    const args = ['--distribution', distro, '--exec', executable, 'kubeconfig', `--enable=${ state }`];

    try {
      const kubeconfigPath = await this.k3sHelper.findKubeConfigToUpdate('rancher-desktop');

      await childProcess.spawnFile(
        'wsl.exe', args, {
          env: {
            ...process.env,
            KUBECONFIG: kubeconfigPath,
            WSLENV:     `${ process.env.WSLENV }:KUBECONFIG/up`,
          },
          stdio: ['ignore', await Logging.wsl.fdStream, await Logging.wsl.fdStream],
        });
    } catch (error) {
      console.error(`Could not set up kubeconfig integration for ${ distro }:`, error);
      console.error(`Command: wsl.exe ${ args.join(' ') }`);

      return `Error setting up integration`;
    }
    console.log(`kubeconfig integration for ${ distro } set to ${ state }`);
  }
}
