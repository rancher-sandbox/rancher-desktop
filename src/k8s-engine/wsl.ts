// Kubernetes backend for Windows, based on WSL2 + k3s

import events from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import stream from 'stream';
import timers from 'timers';
import util from 'util';

import _ from 'lodash';
import semver from 'semver';

import * as K8s from './k8s';
import K3sHelper, { ShortVersion } from './k3sHelper';
import ProgressTracker from './progressTracker';
import INSTALL_K3S_SCRIPT from '@/assets/scripts/install-k3s';
import SERVICE_SCRIPT_K3S from '@/assets/scripts/service-k3s.initd';
import SERVICE_SCRIPT_DOCKERD from '@/assets/scripts/service-wsl-dockerd.initd';
import LOGROTATE_K3S_SCRIPT from '@/assets/scripts/logrotate-k3s';
import SERVICE_BUILDKITD_INIT from '@/assets/scripts/buildkit.initd';
import SERVICE_BUILDKITD_CONF from '@/assets/scripts/buildkit.confd';
import INSTALL_WSL_HELPERS_SCRIPT from '@/assets/scripts/install-wsl-helpers';
import mainEvents from '@/main/mainEvents';
import * as childProcess from '@/utils/childProcess';
import Logging from '@/utils/logging';
import paths from '@/utils/paths';
import { findHomeDir } from '@/config/findHomeDir';
import { ContainerEngine, Settings } from '@/config/settings';
import resources from '@/resources';
import { getImageProcessor } from '@/k8s-engine/images/imageFactory';

const console = Logging.wsl;
const INSTANCE_NAME = 'rancher-desktop';
const DATA_INSTANCE_NAME = 'rancher-desktop-data';
/**
 * INTEGRATION_HOST is a key for WSLBackend.mobySocketProxyProcesses to indicate
 * the integration (moby socket proxy) process for the Win32 host.
 */
const INTEGRATION_HOST = Symbol('host');

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
  'rancher-desktop-data', // Another internal distro
  'docker-desktop', // Not meant for interactive use
  'docker-desktop-data', // Not meant for interactive use
];

/** The version of the WSL distro we expect. */
const DISTRO_VERSION = '0.12.1';

/**
 * The list of directories that are in the data distribution (persisted across
 * version upgrades).
 */
const DISTRO_DATA_DIRS = [
  '/etc/rancher',
  '/var/lib',
];

type execOptions = childProcess.CommonOptions & {
  /** Output encoding; defaults to utf16le. */
  encoding?: BufferEncoding;
  /** Expect the command to fail; do not log on error.  Exceptions are still thrown. */
  expectFailure?: boolean;
  /** A custom log stream to write to; must have a file descriptor. */
  logStream?: stream.Writable;
};

function defined<T>(input: T | undefined | null): input is T {
  return typeof input !== 'undefined' && input !== null;
}

/**
 * This manages a given persistent background process that must be kept running
 * while the Kubernetes backend is running.
 */
class BackgroundProcess {
  /**
   * The process being managed.
   */
  protected process: childProcess.ChildProcess | null = null;

  /**
   * A descriptive name of this process, for logging.
   */
  protected name: string;

  /**
   * The owning backend.
   */
  protected backend: K8s.KubernetesBackend;

  /**
   * A function which will spawn the process to be monitored.
   */
  protected spawn: () => Promise<childProcess.ChildProcess>;

  /** A function which will terminate the process. */
  protected destroy: (child: childProcess.ChildProcess) => Promise<void>;

  /**
   * Whether the process should be running.
   */
  protected shouldRun = false;

  /**
   * Timer used to restart the process;
   */
  protected timer: NodeJS.Timeout | null = null;

  /**
   *
   * @param backend The owning Kubernetes backend; this is used to avoid running in an invalid state.
   * @param name A descriptive name of the process for logging.
   * @param spawn A function to create the underlying child process.
   * @param destroy Optional function to stop the underlying child process.
   */
  constructor(backend: K8s.KubernetesBackend, name: string, spawn: typeof BackgroundProcess.prototype.spawn, destroy?: typeof BackgroundProcess.prototype.destroy) {
    this.backend = backend;
    this.name = name;
    this.spawn = spawn;
    this.destroy = destroy ?? ((process) => {
      process?.kill('SIGTERM');

      return Promise.resolve();
    });
  }

  /**
   * Start the process asynchronously if it does not already exist, and attempt
   * to keep it running indefinitely.
   */
  start() {
    this.shouldRun = true;
    this.restart();
  }

  /**
   * Attempt to start the process once.
   */
  protected async restart() {
    if (!this.shouldRun || ![K8s.State.STARTING, K8s.State.STARTED].includes(this.backend.state)) {
      console.debug(`Not restarting ${ this.name }: ${ this.shouldRun } / ${ this.backend.state }`);
      await this.stop();

      return;
    }
    if (this.process) {
      await this.destroy(this.process);
    }
    if (this.timer) {
      // Ideally, we should use this.timer.refresh(); however, it does not
      // appear to actually trigger.
      timers.clearTimeout(this.timer);
      this.timer = null;
    }
    console.log(`Launching background process ${ this.name }.`);
    const process = await this.spawn();

    this.process = process;
    process.on('exit', (status, signal) => {
      if ([0, null].includes(status) && ['SIGTERM', null].includes(signal)) {
        console.log(`Background process ${ this.name } exited gracefully.`);
      } else {
        console.log(`Background process ${ this.name } exited with status ${ status } signal ${ signal }`);
      }
      if (!Object.is(process, this.process)) {
        console.log(`Not current ${ this.name } process; nothing to be done.`);

        return;
      }
      if (this.shouldRun) {
        this.timer = timers.setTimeout(this.restart.bind(this), 1_000);
        console.debug(`Background process ${ this.name } will restart.`);
      }
    });
  }

  /**
   * Stop the process and do not restart it.
   */
  async stop() {
    console.log(`Stopping background process ${ this.name }.`);
    this.shouldRun = false;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    if (this.process) {
      await this.destroy(this.process);
    }
  }
}

export default class WSLBackend extends events.EventEmitter implements K8s.KubernetesBackend {
  constructor() {
    super();
    this.k3sHelper.on('versions-updated', () => this.emit('versions-updated'));
    this.k3sHelper.initialize().catch((err) => {
      console.log('k3sHelper.initialize failed: ', err);
    });
    this.progressTracker = new ProgressTracker((progress) => {
      this.progress = progress;
      this.emit('progress');
    });
    this.mobySocketProxyProcesses = {
      [INTEGRATION_HOST]: new BackgroundProcess(this, 'Win32 socket proxy', async() => {
        const exe = resources.executable('wsl-helper');
        const stream = await Logging['wsl-helper'].fdStream;

        return childProcess.spawn(exe, ['docker-proxy', 'serve', ...this.debugArg('--verbose')], {
          stdio:       ['ignore', stream, stream],
          windowsHide: true,
        });
      })
    };
  }

  protected get distroFile() {
    return resources.get(os.platform(), `distro-${ DISTRO_VERSION }.tar`);
  }

  protected get downloadURL() {
    return 'https://github.com/k3s-io/k3s/releases/download';
  }

  protected cfg: Settings['kubernetes'] | undefined;

  /**
   * Reference to the _init_ process in WSL.  All other processes should be
   * children of this one.  Note that this is busybox init, running in a custom
   * mount & pid namespace.
   */
  protected process: childProcess.ChildProcess | null = null;

  /**
   * Handle to processes handling dockerd integration with other WSL
   * distributions.  If the key is INTEGRATION_HOST, then it is the process for
   * the host (i.e. proxies to the Windows pipe).
   */
  protected mobySocketProxyProcesses: Record<string | typeof INTEGRATION_HOST, BackgroundProcess>;

  protected client: K8s.Client | null = null;

  /** Interval handle to update the progress. */
  // The return type is odd because TypeScript is pulling in some of the DOM
  // definitions here, which has an incompatible setInterval/clearInterval.
  protected progressInterval: ReturnType<typeof timers.setInterval> | undefined;

  /** The version of Kubernetes currently running. */
  protected activeVersion: semver.SemVer | null = null;

  /** The port the Kubernetes server is listening on (default 6443) */
  protected currentPort = 0;

  /** The port Kubernetes should listen on; this may not match reality if Kubernetes isn't up. */
  #desiredPort = 6443;

  /** The current container engine; changing this requires a full restart. */
  #currentContainerEngine = ContainerEngine.NONE;

  /** Used for giving better error messages on failure to start or stop
   * The actual underlying lima command
   */
  #lastCommand = '';

  get lastCommand() {
    return this.#lastCommand;
  }

  set lastCommand(value: string) {
    console.log(`Running command ${ value }...`);
    this.#lastCommand = value;
  }

  /** An explanation of the last run command */
  #lastCommandComment = '';

  get lastCommandComment() {
    return this.#lastCommandComment;
  }

  set lastCommandComment(value: string) {
    this.#lastCommandComment = value;
    this.#lastCommand = '';
  }

  /** Helper object to manage available K3s versions. */
  protected k3sHelper = new K3sHelper('x86_64');

  /**
   * The current operation underway; used to avoid responding to state changes
   * when we're in the process of doing a different one.
   */
  protected currentAction: Action = Action.NONE;

  /** Whether debug mode is enabled */
  debug = false;

  emit: K8s.KubernetesBackend['emit'] = this.emit;

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

  progressTracker: ProgressTracker;

  progress: K8s.KubernetesProgress = { current: 0, max: 0 };

  get version(): ShortVersion {
    return this.activeVersion?.version ?? '';
  }

  get port(): number {
    return this.currentPort;
  }

  get availableVersions(): Promise<K8s.VersionEntry[]> {
    return this.k3sHelper.availableVersions;
  }

  get desiredVersion(): Promise<semver.SemVer> {
    return (async() => {
      const availableVersions = (await this.k3sHelper.availableVersions).map(v => v.version);
      const version = semver.parse(this.cfg?.version) ?? availableVersions[0];

      if (!version) {
        throw new Error('No version available');
      }

      const matchedVersion = availableVersions.find(v => v.compare(version) === 0);

      if (matchedVersion) {
        return matchedVersion;
      }

      console.error(`Could not use saved version ${ version.raw }, not in ${ availableVersions }`);

      return availableVersions[0];
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
    const stdout = await this.execWSL({ capture: true }, ...args);

    return stdout.split(/[\r\n]+/).map(x => x.trim()).filter(x => x);
  }

  protected async isDistroRegistered({ distribution = INSTANCE_NAME, runningOnly = false } = {}): Promise<boolean> {
    const distros = await this.registeredDistros({ runningOnly });

    console.log(`Registered distributions: ${ distros }`);

    return distros.includes(distribution || INSTANCE_NAME);
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
    await this.progressTracker.action('Registering WSL distribution', 100, async() => {
      await fs.promises.mkdir(paths.wslDistro, { recursive: true });
      await this.execWSL('--import', INSTANCE_NAME, paths.wslDistro, this.distroFile, '--version', '2');
    });

    if (!await this.isDistroRegistered()) {
      throw new Error(`Error registering WSL2 distribution`);
    }
  }

  /**
   * If the WSL distribution we use to hold the data doesn't exist, create it
   * and copy the skeleton over from the active one.
   */
  protected async initDataDistribution() {
    const workdir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rd-distro-'));

    try {
      if (!await this.isDistroRegistered({ distribution: DATA_INSTANCE_NAME })) {
        await this.progressTracker.action('Initializing WSL data', 100, async() => {
          try {
            // Create a distro archive from the main distro.
            // WSL seems to require a working /bin/sh for initialization.
            const REQUIRED_FILES = [
              '/bin/busybox', // Base tools
              '/bin/mount', // Required for WSL startup
              '/bin/sh', // WSL requires a working shell to initialize
              '/lib', // Dependencies for busybox
              '/etc/wsl.conf', // WSL configuration for minimal startup
              '/etc/passwd', // So WSL can spawn programs as a user
            ];
            const archivePath = path.join(workdir, 'distro.tar');

            console.log('Creating initial data distribution...');
            // Make sure all the extra data directories exist
            await Promise.all(DISTRO_DATA_DIRS.map((dir) => {
              return this.execCommand('/bin/busybox', 'mkdir', '-p', dir);
            }));
            // Figure out what required files actually exist in the distro; they
            // may not exist on various versions.
            const extraFiles = (await Promise.all(REQUIRED_FILES.map(async(path) => {
              try {
                await this.execCommand({ expectFailure: true }, 'busybox', '[', '-e', path, ']');

                return path;
              } catch (ex) {
                // Exception expected - the path doesn't exist
                return undefined;
              }
            }))).filter(defined);

            await this.execCommand('tar', '-cf', await this.wslify(archivePath),
              '-C', '/', ...extraFiles, ...DISTRO_DATA_DIRS);
            await this.execWSL('--import', DATA_INSTANCE_NAME, paths.wslDistroData, archivePath, '--version', '2');
          } catch (ex) {
            console.log(`Error registering data distribution: ${ ex }`);
            await this.execWSL('--unregister', DATA_INSTANCE_NAME);
            throw ex;
          }
        });
      } else {
        console.log('data distro already registered');
      }

      await this.progressTracker.action('Updating WSL data', 100, async() => {
        // We may have extra directories (due to upgrades); copy any new ones over.
        const missingDirs: string[] = [];

        await Promise.all(DISTRO_DATA_DIRS.map(async(dir) => {
          try {
            await this.execWSL({ expectFailure: true, encoding: 'utf-8' },
              '--distribution', DATA_INSTANCE_NAME, '--exec', '/bin/busybox', '[', '!', '-d', dir, ']');
            missingDirs.push(dir);
          } catch (ex) {
            // Directory exists.
          }
        }));
        if (missingDirs.length > 0) {
          // Copy the new directories into the data distribution.
          // Note that we're not using compression, since we (kind of) don't have gzip...
          console.log(`Data distribution missing directories ${ missingDirs }, adding...`);
          const archivePath = await this.wslify(path.join(workdir, 'data.tar'));

          await this.execCommand('tar', '-cf', archivePath, '-C', '/', ...missingDirs);
          await this.execWSL('--distribution', DATA_INSTANCE_NAME, '--exec', '/bin/busybox', 'tar', '-xf', archivePath, '-C', '/');
        }
      });
    } catch (ex) {
      console.log('Error setting up data distribution:', ex);
    } finally {
      await fs.promises.rm(workdir, { recursive: true, force: true });
    }
  }

  /**
   * Mount the data distribution over.
   */
  protected async mountData() {
    const mountRoot = '/mnt/wsl/rancher-desktop/run/data';

    await this.execCommand('mkdir', '-p', mountRoot);
    // Only bind mount the root if it doesn't exist; because this is in the
    // shared mount (/mnt/wsl/), it can persist even if all of our distribution
    // instances terminate, as long as the WSL VM is still running.  Once that
    // happens, it is no longer possible to unmount the bind mount...
    // However, there's an exception: the underlying device could have gone
    // missing (!); if that happens, we _can_ unmount it.
    const mountInfo = await this.execWSL(
      { capture: true, encoding: 'utf-8' },
      '--distribution', DATA_INSTANCE_NAME, '--exec', 'busybox', 'cat', '/proc/self/mountinfo');
    // https://www.kernel.org/doc/html/latest/filesystems/proc.html#proc-pid-mountinfo-information-about-mounts
    // We want fields 5 "mount point" and 10 "mount source".
    const matchRegex = new RegExp(String.raw`
      (?<mountID>\S+)
      (?<parentID>\S+)
      (?<majorMinor>\S+)
      (?<root>\S+)
      (?<mountPoint>\S+)
      (?<mountOptions>\S+)
      (?<optionalFields>.*?)
      -
      (?<fsType>\S+)
      (?<mountSource>\S+)
      (?<superOptions>\S+)
    `.trim().replace(/\s+/g, String.raw`\s+`));
    const mountFields = mountInfo.split(/\r?\n/).map(line => matchRegex.exec(line)).filter(defined);
    let hasValidMount = false;

    for (const mountLine of mountFields) {
      const { mountPoint, mountSource: device } = mountLine.groups ?? {};

      if (mountPoint !== mountRoot || !device) {
        continue;
      }
      // Some times we can have the mount but the disk is missing.
      // In that case we need to umount it, and the re-mount.
      try {
        await this.execWSL(
          { expectFailure: true },
          '--distribution', DATA_INSTANCE_NAME, '--exec', 'busybox', 'test', '-e', device);
        console.debug(`Found a valid mount with ${ device }: ${ mountLine.input }`);
        hasValidMount = true;
      } catch (ex) {
        // Busybox returned error, the devices doesn't exist.  Unmount.
        console.log(`Unmounting missing device ${ device }: ${ mountLine.input }`);
        await this.execWSL(
          '--distribution', DATA_INSTANCE_NAME, '--exec', 'busybox', 'umount', mountRoot);
      }
    }

    if (!hasValidMount) {
      console.log(`Did not find a valid mount, mounting ${ mountRoot }`);
      await this.execWSL('--distribution', DATA_INSTANCE_NAME, 'mount', '--bind', '/', mountRoot);
    }
    await Promise.all(DISTRO_DATA_DIRS.map(async(dir) => {
      await this.execCommand('mkdir', '-p', dir);
      await this.execCommand('mount', '-o', 'bind', `${ mountRoot }/${ dir.replace(/^\/+/, '') }`, dir);
    }));
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
    // Attempting to terminate a terminated distribution is a no-op.
    await Promise.all([
      this.execWSL('--terminate', INSTANCE_NAME),
      this.execWSL('--terminate', DATA_INSTANCE_NAME),
      ...Object.values(this.mobySocketProxyProcesses).map(proc => proc.stop())
    ]);
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
  protected async persistVersion(version: semver.SemVer): Promise<void> {
    const filepath = '/var/lib/rancher/k3s/version';

    await this.execCommand('/bin/sh', '-c', `echo '${ version.version }' > ${ filepath }`);
  }

  /**
   * Look up the previously persisted version.
   */
  protected async getPersistedVersion(): Promise<ShortVersion | undefined> {
    const filepath = '/var/lib/rancher/k3s/version';

    try {
      return (await this.captureCommand({ expectFailure: true }, '/bin/cat', filepath)).trim();
    } catch (ex) {
      return undefined;
    }
  }

  protected async deleteIncompatibleData(desiredVersion: semver.SemVer) {
    const existingVersion = await this.getPersistedVersion();

    if (!existingVersion) {
      return;
    }
    if (semver.gt(existingVersion, desiredVersion)) {
      console.log(`Deleting incompatible Kubernetes state due to downgrade from ${ existingVersion } to ${ desiredVersion }...`);
      await this.progressTracker.action(
        'Deleting incompatible Kubernetes state',
        100,
        this.k3sHelper.deleteKubeState((...args) => this.execCommand(...args)));
    }
  }

  /**
   * Write the given contents to a given file name in the RD WSL distribution.
   * @param filePath The destination file path, in the WSL distribution.
   * @param fileContents The contents of the file.
   * @param permissions The file permissions.
   */
  protected async writeFile(filePath: string, fileContents: string, permissions: fs.Mode = 0o644) {
    const workdir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `rd-${ path.basename(filePath) }-`));

    try {
      const scriptPath = path.join(workdir, path.basename(filePath));
      const wslScriptPath = await this.wslify(scriptPath);

      await fs.promises.writeFile(scriptPath, fileContents.replace(/\r/g, ''), 'utf-8');
      await this.execCommand('cp', wslScriptPath, filePath);
      await this.execCommand('chmod', permissions.toString(8), filePath);
    } finally {
      await fs.promises.rm(workdir, { recursive: true });
    }
  }

  /**
   * Run the given installation script.
   * @param scriptContents The installation script contents to run (in WSL).
   * @param args Arguments for the script.
   */
  protected async runInstallScript(scriptContents: string, scriptName: string, ...args: string[]) {
    const workdir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `rd-${ scriptName }-`));

    try {
      const scriptPath = path.join(workdir, scriptName);
      const wslScriptPath = await this.wslify(scriptPath);

      await fs.promises.writeFile(scriptPath, scriptContents.replace(/\r/g, ''), 'utf-8');
      await this.execCommand('chmod', 'a+x', wslScriptPath);
      await this.execCommand(wslScriptPath, ...args);
    } finally {
      await fs.promises.rm(workdir, { recursive: true });
    }
  }

  /**
   * Install K3s into the VM for execution.
   * @param version The version to install.
   */
  protected async installK3s(version: semver.SemVer) {
    await this.runInstallScript(INSTALL_K3S_SCRIPT,
      'install-k3s', version.raw, await this.wslify(path.join(paths.cache, 'k3s')));
  }

  /**
   * Install helper tools for WSL (nerdctl integration).
   */
  protected async installWSLHelpers() {
    await this.runInstallScript(INSTALL_WSL_HELPERS_SCRIPT,
      'install-wsl-helpers', await this.wslify(resources.get('linux', 'bin', 'nerdctl-stub')));
  }

  /**
   * On Windows Trivy is run via WSL as there's no native port.
   * Ensure that all relevant files are in the wsl mount, not the windows one.
   */
  protected async installTrivy() {
    // download-resources.sh installed trivy into the resources area
    // This function moves it into /usr/local/bin/ so when trivy is
    // invoked to run through wsl, it runs faster.

    const trivyExecPath = resources.get('linux', 'bin', 'trivy');

    await this.execCommand('mkdir', '-p', '/var/local/bin');
    await this.wslInstall(trivyExecPath, '/usr/local/bin');
  }

  /**
   * debugArg returns the given arguments in an array if the debug flag is
   * set, else an empty array.
   */
  protected debugArg(...args: string[]): string[] {
    return this.debug ? args : [];
  }

  /**
   * execWSL runs wsl.exe with the given arguments, redirecting all output to
   * the log files.
   */
  protected async execWSL(...args: string[]): Promise<void>;
  protected async execWSL(options: execOptions, ...args: string[]): Promise<void>;
  protected async execWSL(options: execOptions & { capture: true }, ...args: string[]): Promise<string>;
  protected async execWSL(optionsOrArg: execOptions | string, ...args: string[]): Promise<void | string> {
    let options: execOptions & { capture?: boolean } = {};

    if (typeof optionsOrArg === 'string') {
      args = [optionsOrArg].concat(...args);
    } else {
      options = optionsOrArg;
    }
    this.lastCommand = `wsl ${ args.join(' ') }`;
    try {
      const stream = options.logStream ?? await Logging['wsl-exec'].fdStream;

      // We need two separate calls so TypeScript can resolve the return values.
      if (options.capture) {
        console.debug(`Capturing output: wsl.exe ${ args.join(' ') }`);
        const { stdout } = await childProcess.spawnFile('wsl.exe', args, {
          ...options,
          encoding:    options.encoding ?? 'utf16le',
          stdio:       ['ignore', 'pipe', stream],
        });

        return stdout;
      }
      console.debug(`Running: wsl.exe ${ args.join(' ') }`);
      await childProcess.spawnFile('wsl.exe', args, {
        ...options,
        encoding:    options.encoding ?? 'utf16le',
        stdio:       ['ignore', stream, stream],
      });
    } catch (ex) {
      if (!options.expectFailure) {
        console.log(`WSL failed to execute wsl.exe ${ args.join(' ') }: ${ ex }`);
      }
      throw ex;
    }
  }

  /**
   * execCommand runs the given command in the K3s WSL environment.
   * @param options Execution options; encoding defaults to utf-8.
   * @param command The command to execute.
   */
  protected async execCommand(...command: string[]): Promise<void>;
  protected async execCommand(options: execOptions, ...command: string[]): Promise<void>;
  protected async execCommand(options: execOptions & { capture: true }, ...command: string[]): Promise<string>;
  protected async execCommand(optionsOrArg: execOptions | string, ...command: string[]): Promise<void | string> {
    let options: execOptions = {};

    if (typeof optionsOrArg === 'string') {
      command = [optionsOrArg].concat(command);
    } else {
      options = optionsOrArg;
    }

    const expectFailure = options.expectFailure ?? false;

    try {
      // Print a slightly different message if execution fails.
      return await this.execWSL({
        encoding: 'utf-8', ...options, expectFailure: true
      }, '--distribution', INSTANCE_NAME, '--exec', ...command);
    } catch (ex) {
      if (!expectFailure) {
        console.log(`WSL: executing: ${ command.join(' ') }: ${ ex }`);
      }
      throw ex;
    }
  }

  /**
   * captureCommand runs the given command in the K3s WSL environment and returns
   * the standard output.
   * @param command The command to execute.
   * @param command The command to execute.
   * @returns The output of the command.
   */
  protected async captureCommand(...command: string[]): Promise<string>;
  protected async captureCommand(options: execOptions, ...command: string[]): Promise<string>;
  protected async captureCommand(optionsOrArg: execOptions | string, ...command: string[]): Promise<string> {
    if (typeof optionsOrArg === 'string') {
      return await this.execCommand({ capture: true }, optionsOrArg, ...command);
    }

    return await this.execCommand({ ...optionsOrArg, capture: true }, ...command);
  }

  /** Get the IPv4 address of the VM, assuming it's already up. */
  get ipAddress(): Promise<string | undefined> {
    return (async() => {
      // We need to locate the _local_ route (netmask) for eth0, and then
      // look it up in /proc/net/fib_trie to find the local address.
      const routesString = await this.captureCommand('cat', '/proc/net/route');
      const routes = routesString.split(/\r?\n/).map(line => line.split(/\s+/));
      const route = routes.find(route => route[0] === 'eth0' && route[1] !== '00000000');

      if (!route) {
        return undefined;
      }
      const net = Array.from(route[1].matchAll(/../g)).reverse().map(n => parseInt(n.toString(), 16)).join('.');
      const trie = await this.captureCommand('cat', '/proc/net/fib_trie');
      const lines = _.takeWhile(trie.split(/\r?\n/).slice(1), line => /^\s/.test(line));
      const iface = _.dropWhile(lines, line => !line.includes(`${ net }/`));
      const addr = iface.find((_, i, array) => array[i + 1]?.includes('/32 host LOCAL'));

      return addr?.split(/\s+/).pop();
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

        return new K8s.KubernetesError('Error: WSL Not Installed', message, true);
      }
      throw ex;
    }

    return null;
  }

  /**
   * Check the WSL distribution version is acceptable; upgrade the distro
   * version if it is too old.
   */
  protected async upgradeDistroAsNeeded() {
    if (!await this.isDistroRegistered()) {
      // If the distribution is not registered, there is nothing to upgrade.
      return;
    }
    let existingVersion = await this.getDistroVersion();

    if (!semver.valid(existingVersion, true)) {
      existingVersion += '.0';
    }
    let desiredVersion = DISTRO_VERSION;

    if (!semver.valid(desiredVersion, true)) {
      desiredVersion += '.0';
    }
    if (semver.lt(existingVersion, desiredVersion, true)) {
      // Make sure we copy the data over before we delete the old distro
      await this.progressTracker.action('Upgrading WSL distribution', 100, async() => {
        await this.initDataDistribution();
        await this.execWSL('--unregister', INSTANCE_NAME);
      });
    }
  }

  /**
   * Runs /sbin/init in the Rancher Desktop WSL2 distribution.
   * This manages {this.process}.
   */
  protected async runInit() {
    const stream = await Logging['wsl-exec'].fdStream;
    const PID_FILE = '/var/run/wsl-init.pid';

    // Delete any stale wsl-init PID file
    try {
      await this.execCommand('rm', '-f', PID_FILE);
    } catch {
    }

    // The process should already be gone by this point, but make sure.
    this.process?.kill('SIGTERM');
    this.process = childProcess.spawn('wsl.exe',
      ['--distribution', INSTANCE_NAME, '--exec', '/usr/local/bin/wsl-init'],
      {
        env: {
          ...process.env,
          WSLENV:           `${ process.env.WSLENV }:DISTRO_DATA_DIRS`,
          DISTRO_DATA_DIRS: DISTRO_DATA_DIRS.join(':'),
        },
        stdio:       ['ignore', stream, stream],
        windowsHide: true,
      });
    this.process.on('exit', async(status, signal) => {
      if ([0, null].includes(status) && ['SIGTERM', null].includes(signal)) {
        console.log('/sbin/init exited gracefully.');
        await this.stop();
      } else {
        console.log(`/sbin/init exited with status ${ status } signal ${ signal }`);
        await this.stop();
        this.setState(K8s.State.ERROR);
      }
    });

    // Wait for the PID file
    const startTime = Date.now();
    const waitTime = 1_000;
    const maxWaitTime = 30_000;

    while (true) {
      try {
        await this.execCommand({ expectFailure: true }, 'test', '-s', PID_FILE);
        break;
      } catch (e) {
        console.log(`Error testing for wsl-init.pid: ${ e }`, e);
      }
      if (Date.now() - startTime > maxWaitTime) {
        throw new Error(`Timed out after waiting for /var/run/wsl-init.pid: ${ maxWaitTime / waitTime } secs`);
      }
      await util.promisify(setTimeout)(waitTime);
    }
  }

  /**
   * Write a configuration file for an OpenRC service.
   * @param service The name of the OpenRC service to configure.
   * @param settings A mapping of configuration values.  This should be shell escaped.
   */
  protected async writeConf(service: string, settings: Record<string, string>) {
    const contents = Object.entries(settings).map(([key, value]) => `${ key }="${ value }"\n`).join('');

    await this.writeFile(`/etc/conf.d/${ service }`, contents);
  }

  /**
   * Start the given OpenRC service.
   * @param service The name of the OpenRC service to execute.
   * @param conf Optional configuration override; if set, this will overwrite /etc/conf.d/{service}.
   */
  protected async startService(service: string, conf: Record<string, string> | undefined) {
    if (conf) {
      await this.writeConf(service, conf);
    }
    // Run rc-update as we have dynamic dependencies.
    await this.execCommand('/sbin/rc-update', '--update');
    await this.execCommand('/usr/local/bin/wsl-service', service, 'start');
  }

  async start(config: Settings['kubernetes']): Promise<void> {
    this.#desiredPort = config.port;
    this.cfg = config;
    this.currentAction = Action.STARTING;
    this.#currentContainerEngine = config?.containerEngine ?? ContainerEngine.NONE;

    this.lastCommandComment = 'Starting Kubernetes';
    await this.progressTracker.action(this.lastCommandComment, 10, async() => {
      try {
        this.setState(K8s.State.STARTING);

        if (this.progressInterval) {
          timers.clearInterval(this.progressInterval);
        }
        this.progressInterval = timers.setInterval(() => {
          const statuses = [
            this.k3sHelper.progress.checksum,
            this.k3sHelper.progress.exe,
            this.k3sHelper.progress.images,
          ];
          const sum = (key: 'current' | 'max') => {
            return statuses.reduce((v, c) => v + c[key], 0);
          };

          this.progressTracker.numeric(
            'Downloading Kubernetes components',
            sum('current'),
            sum('max'),
          );
        }, 250);

        const desiredVersion = await this.desiredVersion;

        await Promise.all([
          (async() => {
            await this.upgradeDistroAsNeeded();
            await this.ensureDistroRegistered();
            await this.initDataDistribution();
          })(),
          this.progressTracker.action(
            'Checking k3s images',
            100,
            this.k3sHelper.ensureK3sImages(desiredVersion)),
        ]);

        if (this.currentAction !== Action.STARTING) {
          // User aborted before we finished
          return;
        }
        timers.clearInterval(this.progressInterval);
        this.progressInterval = undefined;

        // If we were previously running, stop it now.
        this.lastCommandComment = 'Stopping existing instance';
        await this.progressTracker.action(this.lastCommandComment, 100, async() => {
          this.process?.kill('SIGTERM');
          await this.killStaleProcesses();
        });

        this.lastCommandComment = 'Mounting WSL data';
        await this.progressTracker.action(this.lastCommandComment, 100, this.mountData());
        this.lastCommandComment = 'Starting WSL environment';
        await Promise.all([
          this.progressTracker.action(this.lastCommandComment, 100, async() => {
            const logPath = await this.wslify(paths.logs);
            const rotateConf = LOGROTATE_K3S_SCRIPT.replace(/\r/g, '').replace('/var/log', logPath);

            await this.writeFile('/etc/init.d/k3s', SERVICE_SCRIPT_K3S, 0o755);
            await this.writeFile('/etc/init.d/docker', SERVICE_SCRIPT_DOCKERD, 0o755);
            await this.writeConf('docker', {
              WSL_HELPER_BINARY: await this.getWSLHelperPath(),
              LOG_DIR:           logPath,
            });
            await this.writeFile('/etc/logrotate.d/k3s', rotateConf, 0o644);
            await this.runInit();
            await this.writeFile(`/etc/init.d/buildkitd`, SERVICE_BUILDKITD_INIT, 0o755);
            await this.writeFile(`/etc/conf.d/buildkitd`, SERVICE_BUILDKITD_CONF, 0o644);
          }),
          this.progressTracker.action('Installing image scanner', 100, this.installTrivy()),
          this.progressTracker.action('Installing CA certificates', 100, this.installCACerts()),
          this.progressTracker.action('Installing helpers', 50, this.installWSLHelpers()),
          this.progressTracker.action('Installing k3s', 100, async() => {
            await this.deleteIncompatibleData(desiredVersion);
            await this.installK3s(desiredVersion);
            await this.persistVersion(desiredVersion);
          }),
        ]);

        await this.startService('k3s', {
          PORT:                   this.#desiredPort.toString(),
          LOG_DIR:                await this.wslify(paths.logs),
          'export IPTABLES_MODE': 'legacy',
          ENGINE:                 this.#currentContainerEngine,
        });

        if (this.currentAction !== Action.STARTING) {
          // User aborted
          return;
        }

        this.lastCommandComment = 'Waiting for Kubernetes API';
        await this.progressTracker.action(
          this.lastCommandComment,
          100,
          this.k3sHelper.waitForServerReady(() => this.ipAddress, this.#desiredPort));
        this.lastCommandComment = 'Updating kubeconfig';
        await this.progressTracker.action(
          this.lastCommandComment,
          100,
          this.k3sHelper.updateKubeconfig(
            async() => await this.captureCommand(await this.getWSLHelperPath(), 'k3s', 'kubeconfig')));

        if (this.#currentContainerEngine === ContainerEngine.MOBY) {
          await this.progressTracker.action(
            this.lastCommandComment,
            100,
            async() => {
              const integrations = await this.listIntegrations();

              this.mobySocketProxyProcesses[INTEGRATION_HOST].start();
              for (const [distro, status] of Object.entries(integrations)) {
                if (status === true) {
                  await this.setupIntegrationProcess(distro);
                  this.mobySocketProxyProcesses[distro].start();
                } else {
                  await this.mobySocketProxyProcesses[distro]?.stop();
                }
                await this.manageDockerCompose(distro, status === true);
              }
            });
        }

        this.lastCommandComment = 'Waiting for services';
        await this.progressTracker.action(
          this.lastCommandComment,
          50,
          async() => {
            this.client = new K8s.Client();
            await this.client.waitForServiceWatcher();
            this.client.on('service-changed', (services) => {
              this.emit('service-changed', services);
            });
          });
        this.activeVersion = desiredVersion;
        this.currentPort = this.#desiredPort;
        this.emit('current-port-changed', this.currentPort);

        // Trigger kuberlr to ensure there's a compatible version of kubectl in place
        await childProcess.spawnFile(resources.executable('kubectl'), ['config', 'current-context'],
          { stdio: Logging.k8s });

        this.lastCommandComment = 'Waiting for nodes';
        await this.progressTracker.action(
          this.lastCommandComment,
          100,
          async() => {
            if (!await this.client?.waitForReadyNodes()) {
              throw new Error('No client');
            }
          });

        // See comments for this code in lima.ts:start()

        if (config.checkForExistingKimBuilder) {
          this.client ??= new K8s.Client();
          await getImageProcessor(this.#currentContainerEngine, this).removeKimBuilder(this.client.k8sClient);
          // No need to remove kim builder components ever again.
          config.checkForExistingKimBuilder = false;
          this.emit('kim-builder-uninstalled');
        }
        if (this.#currentContainerEngine === ContainerEngine.CONTAINERD) {
          await this.execCommand('/usr/local/bin/wsl-service', '--ifnotstarted', 'buildkitd', 'start');
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
        this.currentAction = Action.NONE;
      }
    });
  }

  protected async installCACerts(): Promise<void> {
    const certs: (string | Buffer)[] = await new Promise((resolve) => {
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
      await fs.promises.rm(workdir, { recursive: true, force: true });
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

      this.lastCommandComment = 'Stopping Kubernetes';
      await this.progressTracker.action(this.lastCommandComment, 10, async() => {
        if (await this.isDistroRegistered({ runningOnly: true })) {
          await this.execCommand('/usr/local/bin/wsl-service', 'k3s', 'stop');
          await this.execCommand('/usr/local/bin/wsl-service', '--ifstarted', 'docker', 'stop');
          await this.execCommand('/usr/local/bin/wsl-service', '--ifstarted', 'buildkitd', 'stop');
        }
        this.process?.kill('SIGTERM');
        await Promise.all(Object.values(this.mobySocketProxyProcesses).map(proc => proc.stop()));
        if (await this.isDistroRegistered({ runningOnly: true })) {
          await this.execWSL('--terminate', INSTANCE_NAME);
        }
      });
      this.setState(K8s.State.STOPPED);
    } catch (ex) {
      this.setState(K8s.State.ERROR);
      throw ex;
    } finally {
      this.currentAction = Action.NONE;
    }
  }

  async del(): Promise<void> {
    this.lastCommandComment = 'Deleting Kubernetes';
    await this.progressTracker.action(this.lastCommandComment, 20, async() => {
      await this.stop();
      if (await this.isDistroRegistered()) {
        await this.execWSL('--unregister', INSTANCE_NAME);
      }
      if (await this.isDistroRegistered({ distribution: DATA_INSTANCE_NAME })) {
        await this.execWSL('--unregister', DATA_INSTANCE_NAME);
      }
      this.cfg = undefined;
    });
  }

  async reset(config: Settings['kubernetes']): Promise<void> {
    this.lastCommandComment = 'Resetting Kubernetes state...';
    await this.progressTracker.action(this.lastCommandComment, 5, async() => {
      await this.stop();
      // Mount the data first so they can be deleted correctly.
      await this.mountData();
      await this.k3sHelper.deleteKubeState((...args) => this.execCommand(...args));
      await this.start(config);
    });
  }

  async factoryReset(): Promise<void> {
    // The main application data directories will be deleted by a helper
    // application; we only need to unregister the WSL data.
    await this.del();
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
        return resolve({}); // No need to restart if nothing exists
      }
      cmp('port', this.currentPort, this.cfg.port ?? this.currentPort);
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
  protected getWSLHelperPath(): Promise<string> {
    // We need to get the Linux path to our helper executable; it is easier to
    // just get WSL to do the transformation for us.
    return this.wslify(resources.get('linux', 'wsl-helper'));
  }

  async listIntegrations(): Promise<Record<string, boolean | string>> {
    const result: Record<string, boolean | string> = {};

    const executable = await this.getWSLHelperPath();

    for (const distro of await this.registeredDistros()) {
      if (DISTRO_BLACKLIST.includes(distro)) {
        continue;
      }

      try {
        const kubeconfigPath = await this.k3sHelper.findKubeConfigToUpdate('rancher-desktop');
        const stdout = await this.execWSL(
          {
            capture:  true,
            encoding: 'utf-8',
            env:      {
              ...process.env,
              KUBECONFIG: kubeconfigPath,
              WSLENV:     `${ process.env.WSLENV }:KUBECONFIG/up`,
            },
          },
          '--distribution', distro, '--exec', executable, 'kubeconfig', '--show');

        if (['true', 'false'].includes(stdout.trim())) {
          result[distro] = stdout.trim() === 'true';
        } else {
          result[distro] = stdout.trim();
        }
      } catch (error) {
        if (typeof error === 'object') {
          result[distro] = error?.toString() || false;
        }
      }
    }

    return result;
  }

  listIntegrationWarnings(): void {
    // No implementation warnings available.
  }

  // Set up the background process for integrating with a different WSL
  // distribution to proxy the dockerd socket.
  protected async setupIntegrationProcess(distro: string) {
    const executable = await this.getWSLHelperPath();

    this.mobySocketProxyProcesses[distro] ??= new BackgroundProcess(this, `${ distro } socket proxy`,
      async() => {
        const logStream = await Logging[`wsl-helper.${ distro }`].fdStream;

        return childProcess.spawn('wsl.exe',
          ['--distribution', distro, '--user', 'root', '--exec', executable,
            'docker-proxy', 'serve', ...this.debugArg('--verbose')],
          { stdio: ['ignore', logStream, logStream], windowsHide: true }
        );
      },
      async(child: childProcess.ChildProcess) => {
        const logStream = await Logging[`wsl-helper.${ distro }`].fdStream;

        child.kill('SIGTERM');
        await this.execWSL({ encoding: 'utf-8', logStream },
          '--distribution', distro, '--user', 'root', '--exec', executable,
          'docker-proxy', 'kill', ...this.debugArg('--verbose'));
      });
  }

  async setIntegration(distro: string, state: boolean): Promise<string | undefined> {
    if (!(await this.registeredDistros()).includes(distro)) {
      console.error(`Cannot integrate with unregistered distro ${ distro }`);

      return 'Unknown distribution';
    }
    const executable = await this.getWSLHelperPath();

    try {
      const kubeconfigPath = await this.k3sHelper.findKubeConfigToUpdate('rancher-desktop');

      await this.execWSL(
        {
          encoding: 'utf-8',
          env:      {
            ...process.env,
            KUBECONFIG: kubeconfigPath,
            WSLENV:     `${ process.env.WSLENV }:KUBECONFIG/up`,
          },
        },
        '--distribution', distro, '--exec', executable, 'kubeconfig', `--enable=${ state }`,
      );
      if (state) {
        await this.setupIntegrationProcess(distro);
        this.mobySocketProxyProcesses[distro].start();
      } else {
        await this.mobySocketProxyProcesses[distro]?.stop();
      }
      await this.manageDockerCompose(distro, state);
    } catch (error) {
      console.error(`Could not set up kubeconfig integration for ${ distro }:`, error);

      return `Error setting up integration`;
    }
    console.log(`kubeconfig integration for ${ distro } set to ${ state }`);
  }

  protected async manageDockerCompose(distro: string, state: boolean) {
    const srcPath = await this.wslify(resources.get('linux', 'bin', 'docker-compose'));
    const destDir = '$HOME/.docker/cli-plugins';
    const destPath = `${ destDir }/docker-compose`;

    // Update only the distro -- the current
    if (state) {
      await this.execWSL('--distribution', distro, '/bin/sh', '-c', `mkdir -p "${ destDir }"`);
      await this.execWSL('--distribution', distro, '/bin/sh', '-c', `if [ ! -e "${ destPath }" -a ! -L "${ destPath }" ] ; then ln -s "${ srcPath }" "${ destPath }" ; fi`);
      await this.updateDockerComposeLocally();
    } else {
      try {
        // This is preferred to doing the readlink and rm in one long /bin/sh statement because
        // then we rely on the distro's readlink supporting the -n option. Gnu/linux readlink supports -f,
        // On macOS the -f means something else (not that we're likely to see macos WSLs).
        const targetPath = (await this.execWSL({ capture: true, encoding: 'utf-8' },
          '--distribution', distro, 'readlink', '-f', destPath)).trimEnd();

        if (targetPath === srcPath) {
          await this.execWSL('--distribution', distro, 'rm', destPath);
        }
      } catch (err) {
        console.log(`Failed to readlink/rm ${ destPath }`, err);
      }
    }
  }

  // The code never deletes %HOME%/.docker/cli-plugins/docker-compose.exe, so check to create only once.
  #checkedDockerCompose = false;

  protected async updateDockerComposeLocally() {
    // Do the same as manageDockerCompose, but locally
    if (this.#checkedDockerCompose) {
      return;
    }
    const homeDir = findHomeDir();

    if (!homeDir) {
      throw new Error("Can't find home directory");
    }
    const cliDir = path.join(homeDir, '.docker', 'cli-plugins');
    const cliPath = path.join(cliDir, 'docker-compose.exe');
    const srcPath = resources.executable('docker-compose');

    try {
      await fs.promises.access(cliPath);
      // Nothing to do if the file exists
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        await fs.promises.mkdir(cliDir, { recursive: true });
      } else {
        console.error(`Can't create the cli-plugins directory:`, err);

        return;
      }
      try {
        await fs.promises.copyFile(srcPath, cliPath, fs.constants.COPYFILE_EXCL);
      } catch (err2) {
        console.error(`Failed to copy file ${ srcPath } to ${ cliPath }`, err2);

        return;
      }
    }
    this.#checkedDockerCompose = true;
  }

  async getFailureDetails(): Promise<K8s.FailureDetails> {
    const loglines = (await fs.promises.readFile(console.path, 'utf-8')).split('\n').slice(-10);
    const details: K8s.FailureDetails = {
      lastCommand:        this.lastCommand,
      lastCommandComment: this.lastCommandComment,
      lastLogLines:       loglines,
    };

    return details;
  }
}
