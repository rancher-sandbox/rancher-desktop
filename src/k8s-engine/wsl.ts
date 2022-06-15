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

import tar from 'tar-stream';
import * as K8s from './k8s';
import K3sHelper, { ShortVersion } from './k3sHelper';
import ProgressTracker from './progressTracker';
import FLANNEL_CONFLIST from '@/assets/scripts/10-flannel.conflist';
import CONTAINERD_CONFIG from '@/assets/scripts/k3s-containerd-config.toml';
import DOCKER_CREDENTIAL_SCRIPT from '@/assets/scripts/docker-credential-rancher-desktop';
import INSTALL_K3S_SCRIPT from '@/assets/scripts/install-k3s';
import SERVICE_SCRIPT_CRI_DOCKERD from '@/assets/scripts/service-cri-dockerd.initd';
import SERVICE_SCRIPT_K3S from '@/assets/scripts/service-k3s.initd';
import SERVICE_SCRIPT_DOCKERD from '@/assets/scripts/service-wsl-dockerd.initd';
import LOGROTATE_K3S_SCRIPT from '@/assets/scripts/logrotate-k3s';
import SERVICE_BUILDKITD_INIT from '@/assets/scripts/buildkit.initd';
import SERVICE_BUILDKITD_CONF from '@/assets/scripts/buildkit.confd';
import SERVICE_SCRIPT_HOST_RESOLVER from '@/assets/scripts/service-host-resolver.initd';
import SERVICE_SCRIPT_DNSMASQ_GENERATE from '@/assets/scripts/dnsmasq-generate.initd';
import INSTALL_WSL_HELPERS_SCRIPT from '@/assets/scripts/install-wsl-helpers';
import WSL_INIT_SCRIPT from '@/assets/scripts/wsl-init';
import SCRIPT_DATA_WSL_CONF from '@/assets/scripts/wsl-data.conf';
import SERVICE_CREDHELPER_VTUNNEL_PEER from '@/assets/scripts/service-credhelper-vtunnel-peer.initd';
import mainEvents from '@/main/mainEvents';
import BackgroundProcess from '@/utils/backgroundProcess';
import * as childProcess from '@/utils/childProcess';
import clone from '@/utils/clone';
import Logging from '@/utils/logging';
import paths from '@/utils/paths';
import { wslHostIPv4Address } from '@/utils/networks';
import { defined, RecursivePartial, RecursiveReadonly } from '@/utils/typeUtils';
import { ContainerEngine, Settings } from '@/config/settings';
import resources from '@/utils/resources';
import { jsonStringifyWithWhiteSpace } from '@/utils/stringify';
import { getImageProcessor } from '@/k8s-engine/images/imageFactory';
import { getServerCredentialsPath, ServerState } from '@/main/credentialServer/httpCredentialHelperServer';

const console = Logging.wsl;
const INSTANCE_NAME = 'rancher-desktop';
const DATA_INSTANCE_NAME = 'rancher-desktop-data';

const ETC_RANCHER_DESKTOP_DIR = '/etc/rancher/desktop';
const CREDENTIAL_FORWARDER_SETTINGS_PATH = `${ ETC_RANCHER_DESKTOP_DIR }/credfwd`;
const DOCKER_CREDENTIAL_PATH = '/usr/local/bin/docker-credential-rancher-desktop';
const ROOT_DOCKER_CONFIG_DIR = '/root/.docker';
const ROOT_DOCKER_CONFIG_PATH = `${ ROOT_DOCKER_CONFIG_DIR }/config.json`;

/**
 * Enumeration for tracking what operation the backend is undergoing.
 */
enum Action {
  NONE = 'idle',
  STARTING = 'starting',
  STOPPING = 'stopping',
}

/** The version of the WSL distro we expect. */
const DISTRO_VERSION = '0.24';

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

/** Execution options for commands running in a WSL distribution. */
type wslExecOptions = execOptions & {
  /** WSL distribution; defaults to the INSTANCE_NAME. */
  distro?: string;
};

export default class WSLBackend extends events.EventEmitter implements K8s.KubernetesBackend {
  constructor() {
    super();
    this.k3sHelper.on('versions-updated', () => this.emit('versions-updated'));
    this.k3sHelper.initialize().catch((err) => {
      console.log('k3sHelper.initialize failed: ', err);
    });
    mainEvents.on('network-ready', () => this.k3sHelper.networkReady());
    this.progressTracker = new ProgressTracker((progress) => {
      this.progress = progress;
      this.emit('progress');
    });
    this.resolverHostProcess = new BackgroundProcess('host-resolver vsock host', {
      spawn: async() => {
        const exe = path.join(paths.resources, 'win32', 'internal', 'host-resolver.exe');
        const stream = await Logging['host-resolver-host'].fdStream;
        const wslHostAddr = wslHostIPv4Address();

        return childProcess.spawn(exe, ['vsock-host',
          '--built-in-hosts',
          `host.rancher-desktop.internal=${ wslHostAddr },host.docker.internal=${ wslHostAddr }`], {
          stdio:       ['ignore', stream, stream],
          windowsHide: true,
        });
      },
      shouldRun: () => Promise.resolve([K8s.State.STARTING, K8s.State.STARTED, K8s.State.DISABLED].includes(this.state)),
    });
  }

  protected get distroFile() {
    return path.join(paths.resources, os.platform(), `distro-${ DISTRO_VERSION }.tar`);
  }

  protected get downloadURL() {
    return 'https://github.com/k3s-io/k3s/releases/download';
  }

  protected cfg: RecursiveReadonly<Settings['kubernetes']> | undefined;

  /**
   * Reference to the _init_ process in WSL.  All other processes should be
   * children of this one.  Note that this is busybox init, running in a custom
   * mount & pid namespace.
   */
  protected process: childProcess.ChildProcess | null = null;

  /**
   * Windows-side process for the host resolver, used to proxy DNS requests via the system APIs.
   */
  protected resolverHostProcess: BackgroundProcess;

  protected client: K8s.Client | null = null;

  /** Interval handle to update the progress. */
  // The return type is odd because TypeScript is pulling in some of the DOM
  // definitions here, which has an incompatible setInterval/clearInterval.
  protected progressInterval: ReturnType<typeof timers.setInterval> | undefined;

  /** The version of Kubernetes currently running. */
  protected activeVersion: semver.SemVer | null = null;

  /** The port the Kubernetes server is listening on (default 6443) */
  protected currentPort = 0;

  /** Not used in wsl.ts */
  get noModalDialogs() {
    throw new Error("internalError: noModalDialogs shouldn't be used in WSL");
  }

  set noModalDialogs(_: boolean) {
    // Nothing to do - this isn't used for WSL
  }

  /** An explanation of the last run command */
  #lastCommandComment = '';

  get lastCommandComment() {
    return this.#lastCommandComment;
  }

  set lastCommandComment(value: string) {
    this.#lastCommandComment = value;
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

  protected writeSetting(changed: RecursivePartial<typeof this.cfg>) {
    mainEvents.emit('settings-write', { kubernetes: changed });
    this.cfg = _.merge({}, this.cfg, changed);
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
    case K8s.State.DISABLED:
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
    return this.cfg?.port ?? 6443;
  }

  /**
   * List the registered WSL2 distributions.
   */
  protected async registeredDistros({ runningOnly = false } = {}): Promise<string[]> {
    const args = ['--list', '--quiet', runningOnly ? '--running' : undefined];
    const distros = (await this.execWSL({ capture: true }, ...args.filter(defined)))
      .split(/\r?\n/g)
      .map(x => x.trim())
      .filter(x => x);

    if (distros.length < 1) {
      // Return early if we find no distributions in this list; listing again
      // with verbose will fail if there are no distributions.
      return [];
    }

    const stdout = await this.execWSL({ capture: true }, '--list', '--verbose');
    // As wsl.exe may be localized, don't check state here.
    const parser = /^[\s*]+(?<name>.*?)\s+\w+\s+(?<version>\d+)\s*$/;

    const result = stdout.trim()
      .split(/[\r\n]+/)
      .slice(1) // drop the title row
      .map(line => line.match(parser))
      .filter(defined)
      .filter(result => result.groups?.version === '2')
      .map(result => result.groups?.name)
      .filter(defined);

    return result.filter(x => distros.includes(x));
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
            const OVERRIDE_FILES = { 'etc/wsl.conf': SCRIPT_DATA_WSL_CONF };
            const REQUIRED_FILES = [
              '/bin/busybox', // Base tools
              '/bin/mount', // Required for WSL startup
              '/bin/sh', // WSL requires a working shell to initialize
              '/lib', // Dependencies for busybox
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

            // The tar-stream package doesn't handle appends well (needs to
            // stream to a temporary file), and busybox tar doesn't support
            // append either.  Luckily Windows ships with a bsdtar that
            // supports it, though it only supports short options.
            for (const [relPath, contents] of Object.entries(OVERRIDE_FILES)) {
              const absPath = path.join(workdir, 'tar', relPath);

              await fs.promises.mkdir(path.dirname(absPath), { recursive: true });
              await fs.promises.writeFile(absPath, contents);
            }
            await childProcess.spawnFile('tar.exe',
              ['-r', '-f', archivePath, '-C', path.join(workdir, 'tar'), ...Object.keys(OVERRIDE_FILES)]);
            await this.execCommand('tar', '-tvf', await this.wslify(archivePath));
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
   * Write out /etc/hosts in the main distribution, copying the bulk of the
   * contents from the data distribution.
   */
  protected async writeHostsFile() {
    await this.progressTracker.action('Updating /etc/hosts', 50, async() => {
      const contents = await fs.promises.readFile(`\\\\wsl$\\${ DATA_INSTANCE_NAME }\\etc\\hosts`, 'utf-8');
      const lines = contents.split(/\r?\n/g)
        .filter(line => !line.includes('host.docker.internal'));
      const hosts = ['host.rancher-desktop.internal', 'host.docker.internal'];
      const extra = [
        '# BEGIN Rancher Desktop configuration.',
        `${ wslHostIPv4Address() } ${ hosts.join(' ') }`,
        '# END Rancher Desktop configuration.',
      ].map(l => `${ l }\n`).join('');

      await fs.promises.writeFile(`\\\\wsl$\\${ INSTANCE_NAME }\\etc\\hosts`,
        lines.join('\n') + extra, 'utf-8');
    });
  }

  /**
   * Return the Linux path to the host-resolver executable.
   */
  protected getHostResolverPeerPath(): Promise<string> {
    return this.wslify(path.join(paths.resources, 'linux', 'internal', 'host-resolver'));
  }

  /**
   * Write configuration for dnsmasq / and /etc/resolv.conf; required before [runInit].
   */
  protected async writeResolvConf() {
    await this.progressTracker.action('Updating DNS configuration', 50,
      // Tell dnsmasq to use the resolv.conf from the data distro as the
      // upstream configuration.
      Promise.all([
        (async() => {
          try {
            const contents = await this.readFile(
              '/etc/resolv.conf', { distro: DATA_INSTANCE_NAME });

            await this.writeFile('/etc/dnsmasq.d/data-resolv-conf', contents);
          } catch (ex) {
            console.error('Failed to copy existing resolv.conf');
            throw ex;
          }
        })(),
        this.writeConf('dnsmasq', { DNSMASQ_OPTS: '--user=dnsmasq --group=dnsmasq' }),
      ]));
  }

  /**
   * Mount the data distribution over.
   *
   * @returns a process that ensures the mount points stay alive by preventing
   * the distribution from being terminated due to being idle.  It should be
   * killed once things are up.
   */
  protected async mountData(): Promise<childProcess.ChildProcess> {
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

    return childProcess.spawn('wsl.exe',
      ['--distribution', INSTANCE_NAME, '--exec', 'sh'], { windowsHide: true });
  }

  /**
   * Convert a Windows path to a path in the WSL subsystem:
   * - Changes \s to /s
   * - Figures out what the /mnt/DRIVE-LETTER path should be
   */
  protected async wslify(windowsPath: string, distro?: string): Promise<string> {
    return (await this.captureCommand({ distro }, 'wslpath', '-a', '-u', windowsPath)).trimEnd();
  }

  protected async killStaleProcesses() {
    // Attempting to terminate a terminated distribution is a no-op.
    await Promise.all([
      this.execWSL('--terminate', INSTANCE_NAME),
      this.execWSL('--terminate', DATA_INSTANCE_NAME),
      this.resolverHostProcess.stop(),
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
   * Read the given file in a WSL distribution
   * @param [filePath] the path of the file to read.
   * @param [options] Optional configuratino for reading the file.
   * @param [options.distro=INSTANCE_NAME] The distribution to read from.
   * @param [options.encoding='utf-8'] The encoding to use for the result.
   * @param [options.resolveSymlinks=true] Whether to resolve symlinks before reading.
   */
  protected async readFile(filePath: string, options?: Partial<{
    distro: typeof INSTANCE_NAME | typeof DATA_INSTANCE_NAME,
    encoding: BufferEncoding,
    resolveSymlinks: true,
  }>) {
    const distro = options?.distro ?? INSTANCE_NAME;
    const encoding = options?.encoding ?? 'utf-8';

    if (options?.resolveSymlinks ?? true) {
      filePath = (await this.execCommand({ distro, capture: true }, 'busybox', 'readlink', '-f', filePath)).trim();
    }

    // Run wslpath here, to ensure that WSL generates any files we need.
    const windowsPath = (await this.execCommand({
      distro, encoding, capture: true
    }, '/bin/wslpath', '-w', filePath)).trim();

    return await fs.promises.readFile(windowsPath, options?.encoding ?? 'utf-8');
  }

  /**
   * Write the given contents to a given file name in the given WSL distribution.
   * @param filePath The destination file path, in the WSL distribution.
   * @param fileContents The contents of the file.
   * @param [options] An object with fields .permissions=0o644 (the file permissions); and .distro=INSTANCE_NAME (WSL distribution to write to).
   */
  protected async writeFile(filePath: string, fileContents: string, options?: Partial<{ permissions: fs.Mode, distro: typeof INSTANCE_NAME | typeof DATA_INSTANCE_NAME }>) {
    const distro = options?.distro ?? INSTANCE_NAME;
    const workdir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `rd-${ path.basename(filePath) }-`));

    try {
      const scriptPath = path.join(workdir, path.basename(filePath));
      const wslScriptPath = await this.wslify(scriptPath, distro);

      await fs.promises.writeFile(scriptPath, fileContents.replace(/\r/g, ''), 'utf-8');
      await this.execCommand({ distro }, 'busybox', 'cp', wslScriptPath, filePath);
      await this.execCommand({ distro }, 'busybox', 'chmod', (options?.permissions ?? 0o644).toString(8), filePath);
    } finally {
      await fs.promises.rm(workdir, { recursive: true });
    }
  }

  /**
   * Run the given installation script.
   * @param scriptContents The installation script contents to run (in WSL).
   * @param scriptName An identifying label for the script's temporary directory - has no impact on functionality
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
    const windowsNerdctlPath = path.join(paths.resources, 'linux', 'bin', 'nerdctl-stub');
    const nerdctlPath = await this.wslify(windowsNerdctlPath);

    await this.runInstallScript(INSTALL_WSL_HELPERS_SCRIPT, 'install-wsl-helpers', nerdctlPath);
  }

  protected async installCredentialHelper() {
    const credsPath = getServerCredentialsPath();

    try {
      const vtunnelPeerServer = '127.0.0.1:3030';
      const hostIPAddr = wslHostIPv4Address();
      const stateInfo: ServerState = JSON.parse(await fs.promises.readFile(credsPath, { encoding: 'utf-8' }));
      const escapedPassword = stateInfo.password.replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'");
      // leading `$` is needed to escape single-quotes, as : $'abc\'xyz'
      const leadingDollarSign = stateInfo.password.includes("'") ? '$' : '';
      const fileContents = `CREDFWD_AUTH=${ leadingDollarSign }'${ stateInfo.user }:${ escapedPassword }'
      CREDFWD_URL='http://${ vtunnelPeerServer }'
      `;
      const defaultConfig = { credsStore: 'rancher-desktop' };
      let existingConfig: Record<string, any>;

      await this.writeFile('/etc/init.d/credhelper-vtunnel-peer', SERVICE_CREDHELPER_VTUNNEL_PEER, { permissions: 0o755 });
      await this.writeConf('credhelper-vtunnel-peer', {
        VTUNNEL_PEER_BINARY: await this.getVtunnelPeerPath(),
        LOG_DIR:             await this.wslify(paths.logs),
      });
      await this.execCommand('/sbin/rc-update', 'add', 'credhelper-vtunnel-peer', 'default');

      await this.execCommand('mkdir', '-p', ETC_RANCHER_DESKTOP_DIR);
      await this.writeFile(CREDENTIAL_FORWARDER_SETTINGS_PATH, fileContents, { permissions: 0o644 });
      await this.writeFile(DOCKER_CREDENTIAL_PATH, DOCKER_CREDENTIAL_SCRIPT, { permissions: 0o755 });
      try {
        existingConfig = JSON.parse(await this.captureCommand('cat', ROOT_DOCKER_CONFIG_PATH));
      } catch (err: any) {
        await this.execCommand('mkdir', '-p', ROOT_DOCKER_CONFIG_DIR);
        existingConfig = {};
      }
      _.merge(existingConfig, defaultConfig);
      await this.writeFile(ROOT_DOCKER_CONFIG_PATH, jsonStringifyWithWhiteSpace(existingConfig), { permissions: 0o644 });
    } catch (err: any) {
      console.log('Error trying to create/update docker credential files:', err);
    }
  }

  /**
   * On Windows Trivy is run via WSL as there's no native port.
   * Ensure that all relevant files are in the wsl mount, not the windows one.
   */
  protected async installTrivy() {
    // download-resources.sh installed trivy into the resources area
    // This function moves it into /usr/local/bin/ so when trivy is
    // invoked to run through wsl, it runs faster.

    const trivyExecPath = path.join(paths.resources, 'linux', 'internal', 'trivy');

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
    try {
      const stream = options.logStream ?? await Logging['wsl-exec'].fdStream;

      // We need two separate calls so TypeScript can resolve the return values.
      if (options.capture) {
        console.debug(`Capturing output: wsl.exe ${ args.join(' ') }`);
        const { stdout } = await childProcess.spawnFile('wsl.exe', args, {
          ...options,
          encoding: options.encoding ?? 'utf16le',
          stdio:    ['ignore', 'pipe', stream],
        });

        return stdout;
      }
      console.debug(`Running: wsl.exe ${ args.join(' ') }`);
      await childProcess.spawnFile('wsl.exe', args, {
        ...options,
        encoding: options.encoding ?? 'utf16le',
        stdio:    ['ignore', stream, stream],
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
  protected async execCommand(options: wslExecOptions, ...command: string[]): Promise<void>;
  protected async execCommand(options: wslExecOptions & { capture: true }, ...command: string[]): Promise<string>;
  protected async execCommand(optionsOrArg: wslExecOptions | string, ...command: string[]): Promise<void | string> {
    let options: wslExecOptions = {};

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
      }, '--distribution', options.distro ?? INSTANCE_NAME, '--exec', ...command);
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
  protected async captureCommand(options: wslExecOptions, ...command: string[]): Promise<string>;
  protected async captureCommand(optionsOrArg: wslExecOptions | string, ...command: string[]): Promise<string> {
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

    await this.writeFile('/usr/local/bin/wsl-init', WSL_INIT_SCRIPT, { permissions: 0o755 });

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
        console.debug(`Error testing for wsl-init.pid: ${ e } (will retry)`);
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
   * Start the given OpenRC service.  This should only happen after
   * provisioning, to ensure that provisioning can modify any configuration.
   *
   * @param service The name of the OpenRC service to execute.
   */
  protected async startService(service: string) {
    // Run rc-update as we have dynamic dependencies.
    await this.execCommand('/sbin/rc-update', '--update');
    await this.execCommand('/usr/local/bin/wsl-service', service, 'start');
  }

  /**
   * Verify that the given command runs successfully
   * @param command
   * @protected
   */
  protected async verifyReady(...command: string[]) {
    const startTime = Date.now();
    const maxWaitTime = 60_000;
    const waitTime = 500;

    while (true) {
      const currentTime = Date.now();

      if ((currentTime - startTime) > maxWaitTime) {
        console.log(`Waited more than ${ maxWaitTime / 1000 } secs for ${ command.join(' ') } to succeed. Giving up.`);
        break;
      }
      try {
        await this.execCommand({ expectFailure: true }, ...command);
        break;
      } catch (err) {
        console.debug(`Command ${ command } failed: `, err);
      }
      await util.promisify(setTimeout)(waitTime);
    }
  }

  async start(config_: RecursiveReadonly<Settings['kubernetes']>): Promise<void> {
    const config = this.cfg = _.defaultsDeep(clone(config_),
      { containerEngine: ContainerEngine.NONE }) as RecursiveReadonly<Settings['kubernetes']>;

    this.currentAction = Action.STARTING;

    this.lastCommandComment = config.enabled ? 'Starting Kubernetes' : 'Starting WSL Components';
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

        let desiredVersion: semver.SemVer | null = null;
        const downloadingActions: Array<Promise<void>> = [(async() => {
          await this.upgradeDistroAsNeeded();
          await this.ensureDistroRegistered();
          await this.initDataDistribution();
          await this.writeHostsFile();
          await this.writeResolvConf();
        })(),
        ];

        if (config.enabled) {
          desiredVersion = await this.desiredVersion;
          downloadingActions.push(
            this.progressTracker.action(
              'Checking k3s images',
              100,
              this.k3sHelper.ensureK3sImages(desiredVersion)),
          );
        }
        await Promise.all(downloadingActions);

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
        const distroLock = await this.progressTracker.action(this.lastCommandComment, 100, this.mountData());

        this.lastCommandComment = 'Installing the docker-credential helper';
        // This must run after /etc/rancher is mounted
        await this.installCredentialHelper();

        this.lastCommandComment = 'Starting WSL environment';
        const installerActions = [
          this.progressTracker.action(this.lastCommandComment, 100, async() => {
            const logPath = await this.wslify(paths.logs);
            const rotateConf = LOGROTATE_K3S_SCRIPT.replace(/\r/g, '')
              .replace('/var/log', logPath);

            await this.writeFile('/etc/init.d/host-resolver', SERVICE_SCRIPT_HOST_RESOLVER, { permissions: 0o755 });
            await this.writeFile('/etc/init.d/dnsmasq-generate', SERVICE_SCRIPT_DNSMASQ_GENERATE, { permissions: 0o755 });
            // As `rc-update del …` fails if the service is already not in the run level, we add
            // both `host-resolver` and `dnsmasq` to `default` and then delete the one we
            // don't actually want to ensure that the appropriate one will be active.
            await this.execCommand('/sbin/rc-update', 'add', 'host-resolver', 'default');
            await this.execCommand('/sbin/rc-update', 'add', 'dnsmasq', 'default');
            await this.execCommand('/sbin/rc-update', 'add', 'dnsmasq-generate', 'default');
            await this.writeConf('host-resolver', {
              RESOLVER_PEER_BINARY: await this.getHostResolverPeerPath(),
              LOG_DIR:              logPath,
            });
            if (config.experimentalHostResolver) {
              console.debug(`launching experimental DNS host-resolver`);
              try {
                this.resolverHostProcess.start();
              } catch (error) {
                console.error('Failed to run host-resolver vsock-host process:', error);
              }
              await this.execCommand('/sbin/rc-update', 'del', 'dnsmasq-generate', 'default');
              await this.execCommand('/sbin/rc-update', 'del', 'dnsmasq', 'default');
            } else {
              await this.execCommand('/sbin/rc-update', 'del', 'host-resolver', 'default');
            }
            await this.writeFile('/etc/init.d/cri-dockerd', SERVICE_SCRIPT_CRI_DOCKERD, { permissions: 0o755 });
            await this.writeConf('cri-dockerd', {
              ENGINE:  config.containerEngine,
              LOG_DIR: logPath,
            });
            await this.writeFile('/etc/init.d/k3s', SERVICE_SCRIPT_K3S, { permissions: 0o755 });
            await this.writeFile('/etc/logrotate.d/k3s', rotateConf);
            await this.execCommand('mkdir', '-p', '/etc/cni/net.d');
            if (config.options.flannel) {
              await this.writeFile('/etc/cni/net.d/10-flannel.conflist', FLANNEL_CONFLIST);
            }
            await this.writeFile('/etc/containerd/config.toml', CONTAINERD_CONFIG);
            await this.writeConf('containerd', { log_owner: 'root' });
            await this.writeFile('/etc/init.d/docker', SERVICE_SCRIPT_DOCKERD, { permissions: 0o755 });
            await this.writeConf('docker', {
              WSL_HELPER_BINARY: await this.getWSLHelperPath(),
              LOG_DIR:           logPath,
            });
            await this.writeFile(`/etc/init.d/buildkitd`, SERVICE_BUILDKITD_INIT, { permissions: 0o755 });
            await this.writeFile(`/etc/conf.d/buildkitd`, SERVICE_BUILDKITD_CONF);
            await this.execCommand('mkdir', '-p', '/var/lib/misc');

            await this.runInit();
          }),
          this.progressTracker.action('Installing image scanner', 100, this.installTrivy()),
          this.progressTracker.action('Installing CA certificates', 100, this.installCACerts()),
          this.progressTracker.action('Installing helpers', 50, this.installWSLHelpers()),
          this.progressTracker.action('Writing K3s configuration', 50, async() => {
            const k3sConf = {
              PORT:                   config.port.toString(),
              LOG_DIR:                await this.wslify(paths.logs),
              'export IPTABLES_MODE': 'legacy',
              ENGINE:                 config.containerEngine,
              ADDITIONAL_ARGS:        config.options.traefik ? '' : '--disable traefik',
            };

            if (!config.options.flannel) {
              console.log(`Disabling flannel and network policy`);
              k3sConf.ADDITIONAL_ARGS += ' --flannel-backend=none --disable-network-policy';
            }

            await this.writeConf('k3s', k3sConf);
          }),
        ];

        if (config.enabled) {
          const actualDesiredVersion = desiredVersion as semver.SemVer;

          installerActions.push(
            this.progressTracker.action('Installing k3s', 100, async() => {
              await this.deleteIncompatibleData(actualDesiredVersion);
              await this.installK3s(actualDesiredVersion);
              await this.persistVersion(actualDesiredVersion);
            })
          );
        }
        try {
          await Promise.all(installerActions);
        } finally {
          distroLock.kill('SIGTERM');
        }

        this.lastCommandComment = 'Running provisioning scripts';
        await this.progressTracker.action(this.lastCommandComment, 100, this.runProvisioningScripts());

        if (config.containerEngine === ContainerEngine.MOBY) {
          await this.startService('docker');
        } else {
          await this.startService('containerd');
        }

        if (config.enabled) {
          await this.verifyReady(config.containerEngine === ContainerEngine.MOBY ? 'docker' : 'nerdctl', 'images');
          await this.progressTracker.action('Starting k3s', 100, this.startService('k3s'));
        }

        if (this.currentAction !== Action.STARTING) {
          // User aborted
          return;
        }

        if (config.enabled) {
          this.lastCommandComment = 'Waiting for Kubernetes API';
          await this.progressTracker.action(
            this.lastCommandComment,
            100,
            this.k3sHelper.waitForServerReady(() => this.ipAddress, config.port));
          this.lastCommandComment = 'Updating kubeconfig';
          await this.progressTracker.action(
            this.lastCommandComment,
            100,
            async() => {
              // Wait for the file to exist first, for slow machines.
              const command = 'if test -r /etc/rancher/k3s/k3s.yaml; then echo yes; else echo no; fi';

              while (true) {
                const result = await this.captureCommand('/bin/sh', '-c', command);

                if (result.includes('yes')) {
                  break;
                }
                await util.promisify(timers.setTimeout)(1_000);
              }
              await this.k3sHelper.updateKubeconfig(
                async() => await this.captureCommand(await this.getWSLHelperPath(), 'k3s', 'kubeconfig'));
            });
        }

        if (config.enabled) {
          // Remove flannel config if necessary, before starting k3s
          if (!config.options.flannel) {
            await this.execCommand('busybox', 'rm', '-f', '/etc/cni/net.d/10-flannel.conflist');
          }

          const client = this.client = new K8s.Client();

          this.lastCommandComment = 'Waiting for services';
          await this.progressTracker.action(
            this.lastCommandComment,
            50,
            async() => {
              await client.waitForServiceWatcher();
              client.on('service-changed', (services) => {
                this.emit('service-changed', services);
              });
            });
          this.activeVersion = desiredVersion;
          this.currentPort = config.port;
          this.emit('current-port-changed', this.currentPort);

          // Remove traefik if necessary.
          if (!config.options.traefik) {
            await this.progressTracker.action(
              'Removing Traefik',
              50,
              this.k3sHelper.uninstallTraefik(this.client));
          }

          // Trigger kuberlr to ensure there's a compatible version of kubectl in place
          await childProcess.spawnFile(resources.executable('kubectl'), ['config', 'current-context'],
            { stdio: Logging.k8s });

          if (config.options.flannel) {
            this.lastCommandComment = 'Waiting for nodes';
            await this.progressTracker.action(
              this.lastCommandComment,
              100,
              async() => {
                if (!await this.client?.waitForReadyNodes()) {
                  throw new Error('No client');
                }
              });
          } else {
            this.lastCommandComment = 'Skipping node checks, flannel is disabled';
            await this.progressTracker.action(
              this.lastCommandComment,
              100,
              async() => {
                await new Promise(resolve => setTimeout(resolve, 5000));
              });
          }

          // See comments for this code in lima.ts:start()

          if (config.checkForExistingKimBuilder) {
            await getImageProcessor(config.containerEngine, this).removeKimBuilder(this.client.k8sClient);
            // No need to remove kim builder components ever again.
            this.writeSetting({ checkForExistingKimBuilder: false });
            this.emit('kim-builder-uninstalled');
          }
        }
        if (config.containerEngine === ContainerEngine.CONTAINERD) {
          await this.execCommand('/usr/local/bin/wsl-service', '--ifnotstarted', 'buildkitd', 'start');
        }

        this.setState(config.enabled ? K8s.State.STARTED : K8s.State.DISABLED);
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
      // Similar to Lima backends, we better use of tar here to improve the performance in case of
      // many certificates.

      if (certs && certs.length > 0) {
        const writeStream = fs.createWriteStream(path.join(workdir, 'certs.tar'));
        const archive = tar.pack();
        const archiveFinished = util.promisify(stream.finished)(archive);

        archive.pipe(writeStream);

        for (const [index, cert] of certs.entries()) {
          const curried = archive.entry.bind(archive, {
            name: `rd-${ index }.crt`,
            mode: 0o600,
          }, cert);

          await util.promisify(curried)();
        }
        archive.finalize();
        await archiveFinished;

        await this.execCommand(
          'tar', 'xf', await this.wslify(path.join(workdir, 'certs.tar')),
          '-C', '/usr/local/share/ca-certificates/');
      }
    } finally {
      await fs.promises.rm(workdir, { recursive: true, force: true });
    }
    await this.execCommand('/usr/sbin/update-ca-certificates');
  }

  /**
   * Run provisioning scripts; this is done after init is started.
   */
  protected async runProvisioningScripts() {
    const provisioningPath = path.join(paths.config, 'provisioning');

    await fs.promises.mkdir(provisioningPath, { recursive: true });
    await Promise.all([
      (async() => {
        // Write out the readme file.
        const ReadmePath = path.join(provisioningPath, 'README');

        try {
          await fs.promises.access(ReadmePath, fs.constants.F_OK);
        } catch {
          const contents = `${ `
            Any files named '*.start' in this directory will be executed
            sequentially on Rancher Desktop startup, before the main services.
            Files are processed in lexical order, and startup will be delayed
            until they have all run to completion. Similarly, any files named
            '*.stop' will be executed on shutdown, after the main services have
            exited, and delay shutdown until they have run to completion.
            Note that the script file names may not include whitespace.
            `.replace(/\s*\n\s*/g, '\n').trim() }\n`;

          await fs.promises.writeFile(ReadmePath, contents, { encoding: 'utf-8' });
        }
      })(),
      (async() => {
        const linuxPath = await this.wslify(provisioningPath);

        await this.execCommand('/bin/sh', '-c', `
          set -o errexit -o nounset

          # Stop the service if it's already running for some reason.
          # This should never be the case (because we tore down init).
          /usr/local/bin/wsl-service --ifstarted local stop

          # Clobber /etc/local.d and replace it with a symlink to our desired
          # path.  This is needed as /etc/init.d/local does not support
          # overriding the script directory.
          rm -r -f /etc/local.d
          ln -s -f -T "${ linuxPath }" /etc/local.d

          # Ensure all scripts are executable; Windows mounts are unlikely to
          # have it set by default.
          /usr/bin/find \
            /etc/local.d/ \
            '(' -name '*.start' -o -name '*.stop' ')' \
            -print -exec chmod a+x '{}' ';'

          # Run the script.
          exec /usr/local/bin/wsl-service local start
        `.replace(/\r/g, ''));
      })(),
    ]);
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

      this.lastCommandComment = 'Shutting Down...';
      await this.progressTracker.action(this.lastCommandComment, 10, async() => {
        if (await this.isDistroRegistered({ runningOnly: true })) {
          await this.execCommand('/usr/local/bin/wsl-service', '--ifstarted', 'k3s', 'stop');
          await this.execCommand('/usr/local/bin/wsl-service', '--ifstarted', 'docker', 'stop');
          await this.execCommand('/usr/local/bin/wsl-service', '--ifstarted', 'containerd', 'stop');
          await this.execCommand('/usr/local/bin/wsl-service', '--ifstarted', 'buildkitd', 'stop');
          try {
            await this.execCommand('/usr/local/bin/wsl-service', '--ifstarted', 'local', 'stop');
          } catch (ex) {
            // Do not allow errors here to prevent us from stopping.
            console.error('Failed to run user provisioning scripts on stopping:', ex);
          }
        }
        this.process?.kill('SIGTERM');
        await this.resolverHostProcess.stop();
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

  async reset(config: RecursiveReadonly<Settings['kubernetes']>): Promise<void> {
    this.lastCommandComment = 'Resetting Kubernetes state...';
    await this.progressTracker.action(this.lastCommandComment, 5, async() => {
      await this.stop();
      // Mount the data first so they can be deleted correctly.
      const distroLock = await this.mountData();

      try {
        await this.k3sHelper.deleteKubeState((...args) => this.execCommand(...args));
      } finally {
        distroLock.kill('SIGTERM');
      }
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

  requiresRestartReasons(settings: Settings['kubernetes']): Promise<Record<string, K8s.RestartReason | undefined>> {
    if (!this.cfg) {
      return Promise.resolve({}); // No need to restart if nothing exists
    }

    // If we're in the middle of something, or if we're in an error state, there
    // is no need to tell the use about the need to restart.
    const quiet = this.currentAction !== Action.NONE || this.internalState === K8s.State.ERROR;
    const results: Record<string, K8s.RestartReason | undefined> = {};
    const NotFound = Symbol('not-found');

    /**
     * Check the given settings against the last-applied settings to see if we
     * need to restart the backend.
     * @param key The identifier to use for the UI.
     * @param visible Whether to expose the difference to the user.
     * @param path The path in the Settings['kubeneretes'] object to compare.
     */
    const cmp = (key: string, visible: boolean, ...path: string[]) => {
      const currentValue = _.get(this.cfg, path, NotFound);
      const desiredValue = _.get(settings, path, NotFound);

      if (currentValue === NotFound) {
        throw new Error(`Invalid restart check: path ${ path } not found on current values`);
      }
      if (desiredValue === NotFound) {
        throw new Error(`Invalid restart check: path ${ path } not found on desired values`);
      }
      results[key] = _.isEqual(currentValue, desiredValue) ? undefined : {
        currentValue,
        desiredValue,
        visible: visible && !quiet,
      };
      console.debug(`restart-required(${ quiet }):`, path.join('.'), JSON.stringify(currentValue), JSON.stringify(desiredValue), results[key]);
    };

    cmp('version', false, 'version');
    cmp('port', true, 'port');
    cmp('containerEngine', false, 'containerEngine');
    cmp('enabled', false, 'enabled');
    cmp('WLSIntegrations', false, 'WSLIntegrations');
    cmp('options.traefik', false, 'options', 'traefik');
    cmp('options.flannel', false, 'options', 'flannel');
    cmp('host-resolver', false, 'experimentalHostResolver');

    return Promise.resolve(results);
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
  protected getWSLHelperPath(distro?: string): Promise<string> {
    // We need to get the Linux path to our helper executable; it is easier to
    // just get WSL to do the transformation for us.

    return this.wslify(path.join(paths.resources, 'linux', 'wsl-helper'), distro);
  }

  /**
   * Return the Linux path to the vtunnel peer executable.
   */
  protected getVtunnelPeerPath(): Promise<string> {
    // We need to get the Linux path to our helper executable; it is easier to
    // just get WSL to do the transformation for us.

    return this.wslify(path.join(paths.resources, 'linux', 'internal', 'vtunnel'));
  }

  async getFailureDetails(exception: any): Promise<K8s.FailureDetails> {
    const loglines = (await fs.promises.readFile(console.path, 'utf-8')).split('\n').slice(-10);
    const details: K8s.FailureDetails = {
      lastCommand:        exception[childProcess.ErrorCommand],
      lastCommandComment: this.lastCommandComment,
      lastLogLines:       loglines,
    };

    return details;
  }
}
