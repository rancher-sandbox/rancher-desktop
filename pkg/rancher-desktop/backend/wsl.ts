// Kubernetes backend for Windows, based on WSL2 + k3s

import events from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import stream from 'stream';
import util from 'util';

import _ from 'lodash';
import * as reg from 'native-reg';
import semver from 'semver';
import tar from 'tar-stream';

import {
  BackendError,
  BackendEvents,
  BackendProgress,
  BackendSettings,
  execOptions,
  FailureDetails,
  RestartReasons,
  State,
  VMBackend,
  VMExecutor,
} from './backend';
import BackendHelper from './backendHelper';
import { ContainerEngineClient, MobyClient, NerdctlClient } from './containerClient';
import ProgressTracker, { getProgressErrorDescription } from './progressTracker';

import DEPENDENCY_VERSIONS from '@pkg/assets/dependencies.yaml';
import FLANNEL_CONFLIST from '@pkg/assets/scripts/10-flannel.conflist';
import SERVICE_BUILDKITD_CONF from '@pkg/assets/scripts/buildkit.confd';
import SERVICE_BUILDKITD_INIT from '@pkg/assets/scripts/buildkit.initd';
import CONFIGURE_IMAGE_ALLOW_LIST from '@pkg/assets/scripts/configure-allowed-images';
import DOCKER_CREDENTIAL_SCRIPT from '@pkg/assets/scripts/docker-credential-rancher-desktop';
import INSTALL_WSL_HELPERS_SCRIPT from '@pkg/assets/scripts/install-wsl-helpers';
import LOGROTATE_K3S_SCRIPT from '@pkg/assets/scripts/logrotate-k3s';
import LOGROTATE_OPENRESTY_SCRIPT from '@pkg/assets/scripts/logrotate-openresty';
import SERVICE_SCRIPT_MOPROXY from '@pkg/assets/scripts/moproxy.initd';
import NERDCTL from '@pkg/assets/scripts/nerdctl';
import NGINX_CONF from '@pkg/assets/scripts/nginx.conf';
import SERVICE_GUEST_AGENT_INIT from '@pkg/assets/scripts/rancher-desktop-guestagent.initd';
import SERVICE_SCRIPT_CRI_DOCKERD from '@pkg/assets/scripts/service-cri-dockerd.initd';
import SERVICE_SCRIPT_K3S from '@pkg/assets/scripts/service-k3s.initd';
import SERVICE_SCRIPT_DOCKERD from '@pkg/assets/scripts/service-wsl-dockerd.initd';
import SCRIPT_DATA_WSL_CONF from '@pkg/assets/scripts/wsl-data.conf';
import WSL_EXEC from '@pkg/assets/scripts/wsl-exec';
import WSL_INIT_SCRIPT from '@pkg/assets/scripts/wsl-init';
import { ContainerEngine } from '@pkg/config/settings';
import { getServerCredentialsPath, ServerState } from '@pkg/main/credentialServer/httpCredentialHelperServer';
import mainEvents from '@pkg/main/mainEvents';
import BackgroundProcess from '@pkg/utils/backgroundProcess';
import * as childProcess from '@pkg/utils/childProcess';
import clone from '@pkg/utils/clone';
import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';
import { executable } from '@pkg/utils/resources';
import { jsonStringifyWithWhiteSpace } from '@pkg/utils/stringify';
import { defined, RecursivePartial } from '@pkg/utils/typeUtils';

import type { KubernetesBackend } from './k8s';

/* eslint @typescript-eslint/switch-exhaustiveness-check: "error" */

const console = Logging.wsl;
const INSTANCE_NAME = 'rancher-desktop';
const DATA_INSTANCE_NAME = 'rancher-desktop-data';

const ETC_RANCHER_DESKTOP_DIR = '/etc/rancher/desktop';
const CREDENTIAL_FORWARDER_SETTINGS_PATH = `${ ETC_RANCHER_DESKTOP_DIR }/credfwd`;
const DOCKER_CREDENTIAL_PATH = '/usr/local/bin/docker-credential-rancher-desktop';
const ROOT_DOCKER_CONFIG_DIR = '/root/.docker';
const ROOT_DOCKER_CONFIG_PATH = `${ ROOT_DOCKER_CONFIG_DIR }/config.json`;
/** Number of times to retry converting a path between WSL & Windows. */
const WSL_PATH_CONVERT_RETRIES = 10;

/**
 * Enumeration for tracking what operation the backend is undergoing.
 */
export enum Action {
  NONE = 'idle',
  STARTING = 'starting',
  STOPPING = 'stopping',
}

/** The version of the WSL distro we expect. */
const DISTRO_VERSION = DEPENDENCY_VERSIONS.WSLDistro;

/**
 * The list of directories that are in the data distribution (persisted across
 * version upgrades).
 */
const DISTRO_DATA_DIRS = [
  '/etc/rancher',
  '/var/lib',
];

type wslExecOptions = execOptions & {
  /** Output encoding; defaults to utf16le. */
  encoding?: BufferEncoding;
  /** The distribution to execute within. */
  distro?:   string;
};

export default class WSLBackend extends events.EventEmitter implements VMBackend, VMExecutor {
  constructor(kubeFactory: (backend: WSLBackend) => KubernetesBackend) {
    super();
    this.progressTracker = new ProgressTracker((progress) => {
      this.progress = progress;
      this.emit('progress');
    }, console);

    this.hostSwitchProcess = new BackgroundProcess('host-switch.exe', {
      spawn: async() => {
        const exe = path.join(paths.resources, 'win32', 'internal', 'host-switch.exe');
        const stream = await Logging['host-switch'].fdStream;
        const args: string[] = [];

        if (this.cfg?.kubernetes.enabled) {
          const k8sPort = 6443;
          const eth0IP = '192.168.127.2';
          const k8sPortForwarding = `127.0.0.1:${ k8sPort }=${ eth0IP }:${ k8sPort }`;

          args.push('--port-forward', k8sPortForwarding);
        }

        return childProcess.spawn(exe, args, {
          stdio:       ['ignore', stream, stream],
          windowsHide: true,
        });
      },
      shouldRun: () => Promise.resolve([State.STARTING, State.STARTED, State.DISABLED].includes(this.state)),
    });

    this.kubeBackend = kubeFactory(this);
  }

  protected get distroFile() {
    return path.join(paths.resources, os.platform(), `distro-${ DISTRO_VERSION }.tar`);
  }

  /** The current config state. */
  protected cfg: BackendSettings | undefined;

  /** Indicates whether the current installation is an Admin Install. */
  #isAdminInstall: Promise<boolean> | undefined;

  protected getIsAdminInstall(): Promise<boolean> {
    this.#isAdminInstall ??= new Promise((resolve) => {
      let key;

      try {
        key = reg.openKey(reg.HKLM, 'SOFTWARE', reg.Access.READ);

        if (key) {
          const parsedValue = reg.getValue(key, 'SUSE\\RancherDesktop', 'AdminInstall');
          const isAdmin = parsedValue !== null;

          return resolve(isAdmin);
        } else {
          console.debug('Failed to open registry key: HKEY_LOCAL_MACHINE\SOFTWARE');
        }
      } catch (error) {
        console.error(`Error accessing registry: ${ error }`);
      } finally {
        reg.closeKey(key);
      }

      return resolve(false);
    });

    return this.#isAdminInstall;
  }

  /**
   * Reference to the _init_ process in WSL.  All other processes should be
   * children of this one.  Note that this is busybox init, running in a custom
   * mount & pid namespace.
   */
  protected process: childProcess.ChildProcess | null = null;

  /**
   * Windows-side process for the Rancher Desktop Networking,
   * it is used to provide DNS, DHCP and Port Forwarding
   * to the vm-switch that is running in the WSL VM.
   */
  protected hostSwitchProcess: BackgroundProcess;

  readonly kubeBackend:   KubernetesBackend;
  readonly executor = this;
  #containerEngineClient: ContainerEngineClient | undefined;

  get containerEngineClient() {
    if (this.#containerEngineClient) {
      return this.#containerEngineClient;
    }

    throw new Error('Invalid state, no container engine client available.');
  }

  /** A transient property that prevents prompting via modal UI elements. */
  #noModalDialogs = false;

  get noModalDialogs() {
    return this.#noModalDialogs;
  }

  set noModalDialogs(value: boolean) {
    this.#noModalDialogs = value;
  }

  /**
   * The current operation underway; used to avoid responding to state changes
   * when we're in the process of doing a different one.
   */
  currentAction: Action = Action.NONE;

  /** Whether debug mode is enabled */
  debug = false;

  get backend(): 'wsl' {
    return 'wsl';
  }

  writeSetting(changed: RecursivePartial<BackendSettings>) {
    if (changed) {
      mainEvents.emit('settings-write', changed);
    }
    this.cfg = _.merge({}, this.cfg, changed);
  }

  /** The current user-visible state of the backend. */
  protected internalState: State = State.STOPPED;
  get state() {
    return this.internalState;
  }

  protected async setState(state: State) {
    this.internalState = state;
    this.emit('state-changed', this.state);
    switch (this.state) {
    case State.STOPPING:
    case State.STOPPED:
    case State.ERROR:
    case State.DISABLED:
      await this.kubeBackend.stop();
      break;
    case State.STARTING:
    case State.STARTED:
      /* nothing */
    }
  }

  progressTracker: ProgressTracker;

  progress: BackendProgress = { current: 0, max: 0 };

  get cpus(): Promise<number> {
    // This doesn't make sense for WSL2, since that's a global configuration.
    return Promise.resolve(0);
  }

  get memory(): Promise<number> {
    // This doesn't make sense for WSL2, since that's a global configuration.
    return Promise.resolve(0);
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
      .map(line => parser.exec(line))
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
   * Any upgrades to the distribution should be done immediately after this.
   */
  protected async ensureDistroRegistered(): Promise<void> {
    if (!await this.isDistroRegistered()) {
      await this.progressTracker.action('Registering WSL distribution', 100, async() => {
        await fs.promises.mkdir(paths.wslDistro, { recursive: true });
        try {
          await this.execWSL({ capture: true },
            '--import', INSTANCE_NAME, paths.wslDistro, this.distroFile, '--version', '2');
        } catch (ex: any) {
          if (!String(ex.stdout ?? '').includes('ensure virtualization is enabled')) {
            throw ex;
          }
          throw new BackendError('Virtualization not supported', ex.stdout, true);
        }
      });
    }

    if (!await this.isDistroRegistered()) {
      throw new Error(`Error registering WSL2 distribution`);
    }

    await this.initDataDistribution();
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
            // msys comes with its own "tar.exe"; ensure we use the version
            // shipped with Windows.
            const tarExe = path.join(process.env.SystemRoot ?? '', 'system32', 'tar.exe');

            await childProcess.spawnFile(tarExe,
              ['-r', '-f', archivePath, '-C', path.join(workdir, 'tar'), ...Object.keys(OVERRIDE_FILES)],
              { stdio: 'pipe' });
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
      await fs.promises.rm(workdir, { recursive: true, maxRetries: 3 });
    }
  }

  /**
   * Runs wsl-proxy process in the default namespace. This is to proxy
   * other distro's traffic from default namespace into the network namespace.
   */

  protected async runWslProxy() {
    const debug = this.debug ? 'true' : 'false';
    const logDir = await this.wslify(paths.logs);
    const logfile = path.posix.join(logDir, 'wsl-proxy.log');

    try {
      await this.execCommand('/usr/local/bin/wsl-proxy', `-debug=${ debug }`, `-logfile=${ logfile }`);
    } catch (err: any) {
      console.log('Error trying to start wsl-proxy in default namespace:', err);
    }
  }

  /**
   * Write out /etc/hosts in the main distribution, copying the bulk of the
   * contents from the data distribution.
   */
  protected async writeHostsFile(config: BackendSettings) {
    const virtualNetworkStaticAddr = '192.168.127.254';
    const virtualNetworkGatewayAddr = '192.168.127.1';

    await this.progressTracker.action('Updating /etc/hosts', 50, async() => {
      const contents = await fs.promises.readFile(`\\\\wsl$\\${ DATA_INSTANCE_NAME }\\etc\\hosts`, 'utf-8');
      const lines = contents.split(/\r?\n/g)
        .filter(line => !line.includes('host.docker.internal'));
      const hosts = ['host.rancher-desktop.internal', 'host.docker.internal'];
      const extra = [
        '# BEGIN Rancher Desktop configuration.',
        `${ virtualNetworkStaticAddr } ${ hosts.join(' ') }`,
        `${ virtualNetworkGatewayAddr } gateway.rancher-desktop.internal`,
        '# END Rancher Desktop configuration.',
      ].map(l => `${ l }\n`).join('');

      await fs.promises.writeFile(`\\\\wsl$\\${ INSTANCE_NAME }\\etc\\hosts`,
        lines.join('\n') + extra, 'utf-8');
    });
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
  async wslify(windowsPath: string, distro?: string): Promise<string> {
    for (let i = 1; i <= WSL_PATH_CONVERT_RETRIES; i++) {
      const result: string = (await this.captureCommand({ distro }, 'wslpath', '-a', '-u', windowsPath)).trimEnd();

      if (result) {
        return result;
      }
      console.log(`Failed to convert '${ windowsPath }' to a wsl path, retry #${ i }`);
      await util.promisify(setTimeout)(100);
    }

    return '';
  }

  protected async killStaleProcesses() {
    // Attempting to terminate a terminated distribution is a no-op.
    await Promise.all([
      this.execWSL('--terminate', INSTANCE_NAME),
      this.execWSL('--terminate', DATA_INSTANCE_NAME),
      this.hostSwitchProcess.stop(),
    ]);
  }

  /**
   * Copy a file from Windows to the WSL distribution.
   */
  protected async wslInstall(windowsPath: string, targetDirectory: string, targetBasename = ''): Promise<void> {
    const wslSourcePath = await this.wslify(windowsPath);
    const basename = path.basename(windowsPath);
    // Don't use `path.join` or the backslashes will come back.
    const targetFile = `${ targetDirectory }/${ targetBasename || basename }`;

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
   * Read the given file in a WSL distribution
   * @param [filePath] the path of the file to read.
   * @param [options] Optional configuration for reading the file.
   * @param [options.distro=INSTANCE_NAME] The distribution to read from.
   * @param [options.encoding='utf-8'] The encoding to use for the result.
   */
  async readFile(filePath: string, options?: Partial<{
    distro:   typeof INSTANCE_NAME | typeof DATA_INSTANCE_NAME,
    encoding: BufferEncoding,
  }>) {
    const distro = options?.distro ?? INSTANCE_NAME;
    const encoding = options?.encoding ?? 'utf-8';

    filePath = (await this.execCommand({ distro, capture: true }, 'busybox', 'readlink', '-f', filePath)).trim();

    // Run wslpath here, to ensure that WSL generates any files we need.
    for (let i = 1; i <= WSL_PATH_CONVERT_RETRIES; ++i) {
      const windowsPath = (await this.execCommand({
        distro, encoding, capture: true,
      }, '/bin/wslpath', '-w', filePath)).trim();

      if (!windowsPath) {
        // Failed to convert for some reason; try again.
        await util.promisify(setTimeout)(100);
        continue;
      }

      return await fs.promises.readFile(windowsPath, options?.encoding ?? 'utf-8');
    }

    throw new Error(`Failed to convert ${ filePath } to a Windows path.`);
  }

  /**
   * Write the given contents to a given file name in the given WSL distribution.
   * @param filePath The destination file path, in the WSL distribution.
   * @param fileContents The contents of the file.
   * @param [options] An object with fields .permissions=0o644 (the file permissions); and .distro=INSTANCE_NAME (WSL distribution to write to).
   */
  async writeFileWSL(filePath: string, fileContents: string, options?: Partial<{ permissions: fs.Mode, distro: typeof INSTANCE_NAME | typeof DATA_INSTANCE_NAME }>) {
    const distro = options?.distro ?? INSTANCE_NAME;
    const workdir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `rd-${ path.basename(filePath) }-`));

    try {
      const scriptPath = path.join(workdir, path.basename(filePath));
      const wslScriptPath = await this.wslify(scriptPath, distro);

      await fs.promises.writeFile(scriptPath, fileContents.replace(/\r/g, ''), 'utf-8');
      await this.execCommand({ distro }, 'busybox', 'cp', wslScriptPath, filePath);
      await this.execCommand({ distro }, 'busybox', 'chmod', (options?.permissions ?? 0o644).toString(8), filePath);
    } finally {
      await fs.promises.rm(workdir, { recursive: true, maxRetries: 3 });
    }
  }

  /**
   * Write the given contents to a given file name in the VM.
   * The file will be owned by root.
   * @param filePath The destination file path, in the VM.
   * @param fileContents The contents of the file.
   * @param permissions The file permissions.
   */
  async writeFile(filePath: string, fileContents: string, permissions: fs.Mode = 0o644) {
    await this.writeFileWSL(filePath, fileContents, { permissions });
  }

  async copyFileIn(hostPath: string, vmPath: string): Promise<void> {
    // Sometimes WSL has issues copying _from_ the VM.  So we instead do the
    // copying from inside the VM.
    await this.execCommand('/bin/cp', '-f', '-T', await this.wslify(hostPath), vmPath);
  }

  async copyFileOut(vmPath: string, hostPath: string): Promise<void> {
    // Sometimes WSL has issues copying _from_ the VM.  So we instead do the
    // copying from inside the VM.
    await this.execCommand('/bin/cp', '-f', '-T', vmPath, await this.wslify(hostPath));
  }

  /**
   * Run the given installation script.
   * @param scriptContents The installation script contents to run (in WSL).
   * @param scriptName An identifying label for the script's temporary directory - has no impact on functionality
   * @param args Arguments for the script.
   */
  async runInstallScript(scriptContents: string, scriptName: string, ...args: string[]) {
    const workdir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `rd-${ scriptName }-`));

    try {
      const scriptPath = path.join(workdir, scriptName);
      const wslScriptPath = await this.wslify(scriptPath);

      await fs.promises.writeFile(scriptPath, scriptContents.replace(/\r/g, ''), 'utf-8');
      await this.execCommand('chmod', 'a+x', wslScriptPath);
      await this.execCommand(wslScriptPath, ...args);
    } finally {
      await fs.promises.rm(workdir, { recursive: true, maxRetries: 3 });
    }
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
      const credentialServerAddr = 'host.rancher-desktop.internal:6109';
      const stateInfo: ServerState = JSON.parse(await fs.promises.readFile(credsPath, { encoding: 'utf-8' }));
      const escapedPassword = stateInfo.password.replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'");
      // leading `$` is needed to escape single-quotes, as : $'abc\'xyz'
      const leadingDollarSign = stateInfo.password.includes("'") ? '$' : '';
      const fileContents = `CREDFWD_AUTH=${ leadingDollarSign }'${ stateInfo.user }:${ escapedPassword }'
      CREDFWD_URL='http://${ credentialServerAddr }'
      `;
      const defaultConfig = { credsStore: 'rancher-desktop' };
      let existingConfig: Record<string, any>;

      await this.execCommand('mkdir', '-p', ETC_RANCHER_DESKTOP_DIR);
      await this.writeFile(CREDENTIAL_FORWARDER_SETTINGS_PATH, fileContents, 0o644);
      await this.writeFile(DOCKER_CREDENTIAL_PATH, DOCKER_CREDENTIAL_SCRIPT, 0o755);
      try {
        existingConfig = JSON.parse(await this.captureCommand('cat', ROOT_DOCKER_CONFIG_PATH));
      } catch (err: any) {
        await this.execCommand('mkdir', '-p', ROOT_DOCKER_CONFIG_DIR);
        existingConfig = {};
      }
      _.merge(existingConfig, defaultConfig);
      if (this.cfg?.containerEngine.name === ContainerEngine.CONTAINERD) {
        existingConfig = BackendHelper.ensureDockerAuth(existingConfig);
      }
      await this.writeFile(ROOT_DOCKER_CONFIG_PATH, jsonStringifyWithWhiteSpace(existingConfig), 0o644);
    } catch (err: any) {
      console.log('Error trying to create/update docker credential files:', err);
    }
  }

  /**
   * Return the Linux path to the moproxy executable.
   */
  protected getMoproxyPath(): Promise<string> {
    return this.wslify(path.join(paths.resources, 'linux', 'internal', 'moproxy'));
  }

  protected async writeProxySettings(proxy: BackendSettings['experimental']['virtualMachine']['proxy']): Promise<void> {
    if (proxy.address && proxy.port) {
      // Write to /etc/moproxy/proxy.ini
      const protocol = proxy.address.startsWith('socks5://') ? 'socks5' : 'http';
      const address = proxy.address.replace(/(https|http|socks5):\/\//g, '');
      const contents = `[rancher-desktop-proxy]\naddress=${ address }:${ proxy.port }\nprotocol=${ protocol }\n`;
      const attributePrefix = protocol === 'socks5' ? 'socks' : 'http';
      const username = proxy.username ? `${ attributePrefix } username=${ proxy.username }\n` : '';
      const password = proxy.password ? `${ attributePrefix } password=${ proxy.password }\n` : '';

      await this.writeFile(`/etc/moproxy/proxy.ini`, `${ contents }${ username }${ password }`);
    } else {
      await this.writeFile(`/etc/moproxy/proxy.ini`, '; no proxy defined');
    }

    await this.modifyConf('moproxy', { MOPROXY_NOPROXY: proxy.noproxy.join(',') });
  }

  /**
   * handleUpgrade removes all the left over files that
   * were renamed in between releases.
   */
  protected async handleUpgrade(files: string[]) {
    for (const file of files) {
      try {
        await fs.promises.rm(file, { force: true, maxRetries: 3 });
      } catch {
        // ignore the err from exception, since we are
        // removing renamed files from previous releases
      }
    }
  }

  protected async installGuestAgent(kubeVersion: semver.SemVer | undefined, cfg: BackendSettings | undefined) {
    const enableKubernetes = !!kubeVersion;
    const isAdminInstall = await this.getIsAdminInstall();

    const guestAgentConfig: Record<string, string> = {
      LOG_DIR:                  await this.wslify(paths.logs),
      GUESTAGENT_ADMIN_INSTALL: isAdminInstall ? 'true' : 'false',
      GUESTAGENT_KUBERNETES:    enableKubernetes ? 'true' : 'false',
      GUESTAGENT_CONTAINERD:    cfg?.containerEngine.name === ContainerEngine.CONTAINERD ? 'true' : 'false',
      GUESTAGENT_DOCKER:        cfg?.containerEngine.name === ContainerEngine.MOBY ? 'true' : 'false',
      GUESTAGENT_DEBUG:         this.debug ? 'true' : 'false',
      GUESTAGENT_K8S_SVC_ADDR:  isAdminInstall && !cfg?.kubernetes.ingress.localhostOnly ? '0.0.0.0' : '127.0.0.1',
    };

    await Promise.all([
      this.writeFile('/etc/init.d/rancher-desktop-guestagent', SERVICE_GUEST_AGENT_INIT, 0o755),
      this.writeConf('rancher-desktop-guestagent', guestAgentConfig),
    ]);
    await this.execCommand('/sbin/rc-update', 'add', 'rancher-desktop-guestagent', 'default');
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
  protected async execWSL(options: wslExecOptions, ...args: string[]): Promise<void>;
  protected async execWSL(options: wslExecOptions & { capture: true }, ...args: string[]): Promise<string>;
  protected async execWSL(optionsOrArg: wslExecOptions | string, ...args: string[]): Promise<void | string> {
    let options: wslExecOptions & { capture?: boolean } = {};

    if (typeof optionsOrArg === 'string') {
      args = [optionsOrArg].concat(...args);
    } else {
      options = optionsOrArg;
    }
    try {
      let stream = options.logStream;

      if (!stream) {
        const logFile = Logging['wsl-exec'];

        // Write a duplicate log line so we can line up the log files.
        logFile.log(`Running: wsl.exe ${ args.join(' ') }`);
        stream = await logFile.fdStream;
      }

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

  async execCommand(...command: string[]): Promise<void>;
  async execCommand(options: wslExecOptions, ...command: string[]): Promise<void>;
  async execCommand(options: wslExecOptions & { capture: true }, ...command: string[]): Promise<string>;
  async execCommand(optionsOrArg: wslExecOptions | string, ...command: string[]): Promise<void | string> {
    let options: wslExecOptions = {};
    const cwdOptions: string[] = [];

    if (typeof optionsOrArg === 'string') {
      command = [optionsOrArg].concat(command);
    } else {
      options = optionsOrArg;
    }

    if (options.cwd) {
      cwdOptions.push('--cd', options.cwd.toString());
      delete options.cwd;
    }

    const expectFailure = options.expectFailure ?? false;

    try {
      // Print a slightly different message if execution fails.
      return await this.execWSL({
        encoding: 'utf-8', ...options, expectFailure: true,
      }, '--distribution', options.distro ?? INSTANCE_NAME, ...cwdOptions, '--exec', ...command);
    } catch (ex) {
      if (!expectFailure) {
        console.log(`WSL: executing: ${ command.join(' ') }: ${ ex }`);
      }
      throw ex;
    }
  }

  spawn(...command: string[]): childProcess.ChildProcess;
  spawn(options: execOptions, ...command: string[]): childProcess.ChildProcess;
  spawn(optionsOrCommand: execOptions | string, ...command: string[]): childProcess.ChildProcess {
    const args = ['--distribution', INSTANCE_NAME, '--exec', '/usr/local/bin/wsl-exec'];

    if (typeof optionsOrCommand === 'string') {
      args.push(optionsOrCommand);
    } else {
      const options: execOptions = optionsOrCommand;

      // runTrivyScan() calls spawn({root: true}, …), which we ignore because we are already running as root
      if (options.expectFailure || options.logStream || options.env) {
        throw new TypeError('Not supported yet');
      }
    }
    args.push(...command);

    return childProcess.spawn('wsl.exe', args);
  }

  /**
   * captureCommand runs the given command in the K3s WSL environment and returns
   * the standard output.
   * @param command The command to execute.
   * @returns The output of the command.
   */
  protected async captureCommand(...command: string[]): Promise<string>;
  protected async captureCommand(options: wslExecOptions, ...command: string[]): Promise<string>;
  protected async captureCommand(optionsOrArg: wslExecOptions | string, ...command: string[]): Promise<string> {
    let result: string;
    let debugArg: string;

    if (typeof optionsOrArg === 'string') {
      result = await this.execCommand({ capture: true }, optionsOrArg, ...command);
      debugArg = optionsOrArg;
    } else {
      result = await this.execCommand({ ...optionsOrArg, capture: true }, ...command);
      debugArg = JSON.stringify(optionsOrArg);
    }
    console.debug(`captureCommand:\ncommand: (${ debugArg } ${ command.map(s => `'${ s }'`).join(' ') })\noutput: <${ result }>`);

    return result;
  }

  /** Get the IPv4 address of the VM, assuming it's already up. */
  get ipAddress(): Promise<string | undefined> {
    return (async() => {
      // When using mirrored-mode networking, 127.0.0.1 works just fine
      // ...also, there may not even be an `eth0` to find the IP of!
      try {
        const networkModeString = await this.captureCommand('wslinfo', '-n', '--networking-mode');

        if (networkModeString === 'mirrored') {
          return '127.0.0.1';
        }
      } catch {
        // wslinfo is missing (wsl < 2.0.4) - fall back to old behavior
      }

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

  async getBackendInvalidReason(): Promise<BackendError | null> {
    // Check if wsl.exe is available
    try {
      await this.isDistroRegistered();
    } catch (ex: any) {
      const stdout = String(ex.stdout || '');
      const isWSLMissing = (ex as NodeJS.ErrnoException).code === 'ENOENT';
      const isInvalidUsageError = stdout.includes('Usage: ') && !stdout.includes('--exec');

      if (isWSLMissing || isInvalidUsageError) {
        console.log('Error launching WSL: it does not appear to be installed.');
        const message = `
          Windows Subsystem for Linux does not appear to be installed.

          Please install it manually:

          https://docs.microsoft.com/en-us/windows/wsl/install
        `.replace(/[ \t]{2,}/g, '').trim();

        return new BackendError('Error: WSL Not Installed', message, true);
      }
      throw ex;
    }

    return null;
  }

  /**
   * Check the WSL distribution version is acceptable; upgrade the distro
   * version if it is too old.
   * @precondition The distribution is already registered.
   */
  protected async upgradeDistroAsNeeded() {
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
        await this.ensureDistroRegistered();
      });
    }
  }

  /**
   * Runs /sbin/init in the Rancher Desktop WSL2 distribution.
   * This manages {this.process}.
   */
  protected async runInit() {
    const logFile = Logging['wsl-init'];
    const PID_FILE = '/run/wsl-init.pid';
    const streamReaders: Promise<void>[] = [];

    // Delete any stale wsl-init PID file
    try {
      await this.execCommand('rm', '-f', PID_FILE);
    } catch {
    }

    await this.writeFile('/usr/local/bin/wsl-init', WSL_INIT_SCRIPT, 0o755);

    // The process should already be gone by this point, but make sure.
    this.process?.kill('SIGTERM');
    const env: Record<string, string> = {
      ...process.env,
      WSLENV:           `${ process.env.WSLENV }:DISTRO_DATA_DIRS:LOG_DIR/p:RD_DEBUG`,
      DISTRO_DATA_DIRS: DISTRO_DATA_DIRS.join(':'),
      LOG_DIR:          paths.logs,
    };

    if (this.debug) {
      env.RD_DEBUG = '1';
    }
    this.process = childProcess.spawn('wsl.exe',
      ['--distribution', INSTANCE_NAME, '--exec', '/usr/local/bin/wsl-init'],
      {
        env,
        stdio:       ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    for (const readable of [this.process.stdout, this.process.stderr]) {
      if (readable) {
        readable.on('data', (chunk: Buffer | string) => {
          logFile.log(chunk.toString().trimEnd());
        });
        streamReaders.push(stream.promises.finished(readable));
      }
    }
    this.process.on('exit', async(status, signal) => {
      await Promise.allSettled(streamReaders);
      if ([0, null].includes(status) && ['SIGTERM', null].includes(signal)) {
        console.log('/sbin/init exited gracefully.');
        await this.stop();
      } else {
        console.log(`/sbin/init exited with status ${ status } signal ${ signal }`);
        await this.stop();
        await this.setState(State.ERROR);
      }
    });

    // Wait for the PID file
    const startTime = Date.now();
    const waitTime = 1_000;
    const maxWaitTime = 30_000;

    while (true) {
      try {
        const stdout = await this.captureCommand({ expectFailure: true }, 'cat', PID_FILE);

        console.debug(`Read wsl-init.pid: ${ stdout.trim() }`);
        break;
      } catch (e) {
        console.debug(`Error testing for wsl-init.pid: ${ e } (will retry)`);
      }
      if (Date.now() - startTime > maxWaitTime) {
        throw new Error(`Timed out after waiting for /run/wsl-init.pid: ${ maxWaitTime / waitTime } secs`);
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
   * Read the configuration file for an OpenRC service.
   * @param service The name of the OpenRC service to read.
   */
  protected async readConf(service: string): Promise<Record<string, string>> {
    // Matches a k/v-pair and groups it into separated key and value, e.g.:
    // ["key1:"value1"", "key1", ""value1""]
    const confRegex = /(?:^|^)\s*?([\w]+)(?:\s*=\s*?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*(?:[\w.-])*|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/;
    const conf = await this.readFile(`/etc/conf.d/${ service }`);

    const confFields = conf.split(/\r?\n/) // Splits config in array of k/v-pairs (["key1:"value1"", "key2:"value2""])
      // Maps the array into [["key1:"value1"", "key1", ""value1""], ["key2:"value2"", "key2", ""value2""]]
      .map(line => confRegex.exec(line))
      .filter(defined);

    return confFields.reduce((res, curr) => {
      const key = curr[1];
      const value = curr[2].replace(/^(['"])([\s\S]*)\1$/mg, '$2'); // Removes redundant quotes from value

      return { ...res, ...{ [key]: value } };
    }, {} as Record<string, string>);
  }

  /**
   * Updates a service config with the given settings.
   * @param service The name of the OpenRC service to configure.
   * @param settings A mapping of configuration values.
   */
  protected async modifyConf(service: string, settings: Record<string, string>) {
    const current = await this.readConf(service);
    const contents = { ...current, ...settings };

    await this.writeConf(service, contents);
  }

  /**
   * Execute a command on a given OpenRC service.
   *
   * @param service The name of the OpenRC service to execute.
   * @param action The name of the OpenRC service action to execute.
   * @param argument Argument to pass to `wsl-service` (`--ifnotstart`, `--ifstarted`)
   */
  async execService(service: string, action: string, argument = '') {
    await this.execCommand('/usr/local/bin/wsl-service', argument, service, action);
  }

  /**
   * Start the given OpenRC service.  This should only happen after
   * provisioning, to ensure that provisioning can modify any configuration.
   *
   * @param service The name of the OpenRC service to execute.
   */
  async startService(service: string) {
    await this.execCommand('/sbin/rc-update', '--update');
    await this.execService(service, 'start', '--ifnotstarted');
  }

  /**
   * Stop the given OpenRC service.
   *
   * @param service The name of the OpenRC service to stop.
   */
  async stopService(service: string) {
    await this.execService(service, 'stop', '--ifstarted');
  }

  /**
   * Verify that the given command runs successfully
   * @param command
   */
  async verifyReady(...command: string[]) {
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

  async start(config_: BackendSettings): Promise<void> {
    const config = this.cfg = _.defaultsDeep(clone(config_),
      { containerEngine: { name: ContainerEngine.NONE } });
    let kubernetesVersion: semver.SemVer | undefined;
    let isDowngrade = false;

    await this.setState(State.STARTING);
    this.currentAction = Action.STARTING;
    this.#containerEngineClient = undefined;
    await this.progressTracker.action('Initializing Rancher Desktop', 10, async() => {
      try {
        const prepActions = [(async() => {
          await this.ensureDistroRegistered();
          await this.upgradeDistroAsNeeded();
          await this.writeHostsFile(config);
        })()];

        if (config.kubernetes.enabled) {
          prepActions.push((async() => {
            [kubernetesVersion, isDowngrade] = await this.kubeBackend.download(config);
          })());
        }

        // Clear the diagnostic about not having Kubernetes versions
        mainEvents.emit('diagnostics-event', { id: 'kube-versions-available', available: true });

        await this.progressTracker.action('Preparing to start', 0, Promise.all(prepActions));
        if (config.kubernetes.enabled && kubernetesVersion === undefined) {
          if (isDowngrade) {
            // The desired version was unavailable, and the user declined a downgrade.
            this.setState(State.ERROR);

            return;
          }
          // The desired version was unavailable, and we couldn't find a fallback.
          // Notify the user, and turn off Kubernetes.
          mainEvents.emit('diagnostics-event', { id: 'kube-versions-available', available: false });
          this.writeSetting({ kubernetes: { enabled: false } });
        }
        if (this.currentAction !== Action.STARTING) {
          // User aborted before we finished
          return;
        }

        // If we were previously running, stop it now.
        await this.progressTracker.action('Stopping existing instance', 100, async() => {
          try {
            await this.execCommand({ expectFailure: true }, 'rm', '-f', '/var/log/rc.log');
          } catch {}
          this.process?.kill('SIGTERM');
          await this.killStaleProcesses();
        });

        const distroLock = await this.progressTracker.action('Mounting WSL data', 100, this.mountData());

        try {
          await this.progressTracker.action('Installing container engine', 0, Promise.all([
            this.progressTracker.action('Starting WSL environment', 100, async() => {
              const rdNetworkingDNS = 'gateway.rancher-desktop.internal';
              const logPath = await this.wslify(paths.logs);
              const rotateConf = LOGROTATE_K3S_SCRIPT.replace(/\r/g, '')
                .replace('/var/log', logPath);
              const configureWASM = !!this.cfg?.experimental?.containerEngine?.webAssembly?.enabled;

              await Promise.all([
                this.progressTracker.action('Installing the docker-credential helper', 10, async() => {
                  // This must run after /etc/rancher is mounted
                  await this.installCredentialHelper();
                }),
                this.progressTracker.action('DNS configuration', 50, () => {
                  return new Promise<void>((resolve) => {
                    console.debug(`setting DNS server to ${ rdNetworkingDNS } for rancher desktop networking`);
                    try {
                      this.hostSwitchProcess.start();
                    } catch (error) {
                      console.error('Failed to run rancher desktop networking host-switch.exe process:', error);
                    }
                    resolve();
                  });
                }),
                this.progressTracker.action('Kubernetes dockerd compatibility', 50, async() => {
                  await this.writeFile('/etc/init.d/cri-dockerd', SERVICE_SCRIPT_CRI_DOCKERD, 0o755);
                  await this.writeConf('cri-dockerd', {
                    ENGINE:  config.containerEngine.name,
                    LOG_DIR: logPath,
                  });
                }),
                this.progressTracker.action('Kubernetes components', 50, async() => {
                  await this.writeFile('/etc/init.d/k3s', SERVICE_SCRIPT_K3S, 0o755);
                  await this.writeFile('/etc/logrotate.d/k3s', rotateConf);
                  await this.execCommand('mkdir', '-p', '/etc/cni/net.d');
                  if (config.kubernetes.options.flannel) {
                    await this.writeFile('/etc/cni/net.d/10-flannel.conflist', FLANNEL_CONFLIST);
                  }
                }),
                this.progressTracker.action('container engine components', 50, async() => {
                  await BackendHelper.configureContainerEngine(this, configureWASM);
                  await this.writeConf('containerd', { log_owner: 'root' });
                  await this.writeFile('/usr/local/bin/nerdctl', NERDCTL, 0o755);
                  await this.writeFile('/etc/init.d/docker', SERVICE_SCRIPT_DOCKERD, 0o755);
                  await this.writeConf('docker', {
                    WSL_HELPER_BINARY: await this.getWSLHelperPath(),
                    LOG_DIR:           logPath,
                  });
                  await this.writeFile(`/etc/init.d/buildkitd`, SERVICE_BUILDKITD_INIT, 0o755);
                  await this.writeFile(`/etc/conf.d/buildkitd`,
                    `${ SERVICE_BUILDKITD_CONF }\nlog_file=${ logPath }/buildkitd.log\n`);
                }),
                this.progressTracker.action('Proxy Config Setup', 50, async() => {
                  await this.execCommand('mkdir', '-p', '/etc/moproxy');
                  await this.writeConf('moproxy', {
                    MOPROXY_BINARY: await this.getMoproxyPath(),
                    LOG_DIR:        logPath,
                  });
                  await this.writeFile('/etc/init.d/moproxy', SERVICE_SCRIPT_MOPROXY, 0o755);
                  await this.writeProxySettings(config.experimental.virtualMachine.proxy);
                }),
                this.progressTracker.action('Configuring image proxy', 50, async() => {
                  const allowedImagesConf = '/usr/local/openresty/nginx/conf/allowed-images.conf';
                  const resolver = `resolver ${ rdNetworkingDNS } ipv6=off;\n`;

                  await this.writeFile(`/usr/local/openresty/nginx/conf/nginx.conf`, NGINX_CONF, 0o644);
                  await this.writeFile(`/usr/local/openresty/nginx/conf/resolver.conf`, resolver, 0o644);
                  await this.writeFile(`/etc/logrotate.d/openresty`, LOGROTATE_OPENRESTY_SCRIPT, 0o644);

                  await this.runInstallScript(CONFIGURE_IMAGE_ALLOW_LIST, 'configure-allowed-images');
                  if (config.containerEngine.allowedImages.enabled) {
                    const patterns = BackendHelper.createAllowedImageListConf(config.containerEngine.allowedImages);

                    await this.writeFile(allowedImagesConf, patterns, 0o644);
                  } else {
                    await this.execCommand({ root: true }, 'rm', '-f', allowedImagesConf);
                  }
                  const obsoleteImageAllowListConf = path.join(path.dirname(allowedImagesConf), 'image-allow-list.conf');

                  await this.execCommand({ root: true }, 'rm', '-f', obsoleteImageAllowListConf);
                }),
                await this.progressTracker.action('Rancher Desktop guest agent', 50, this.installGuestAgent(kubernetesVersion, this.cfg)),
                // Remove any residual rc artifacts from previous version
                await this.execCommand({ root: true }, 'rm', '-f', '/etc/init.d/vtunnel-peer', '/etc/runlevels/default/vtunnel-peer'),
                await this.execCommand({ root: true }, 'rm', '-f', '/etc/init.d/host-resolver', '/etc/runlevels/default/host-resolver'),
                await this.execCommand({ root: true }, 'rm', '-f', '/etc/init.d/dnsmasq-generate', '/etc/runlevels/default/dnsmasq-generate'),
                await this.execCommand({ root: true }, 'rm', '-f', '/etc/init.d/dnsmasq', '/etc/runlevels/default/dnsmasq'),
              ]);

              await this.writeFile('/usr/local/bin/wsl-exec', WSL_EXEC, 0o755);
              await this.runInit();
              if (configureWASM) {
                try {
                  const version = semver.parse(DEPENDENCY_VERSIONS.spinCLI);
                  const env = {
                    KUBE_PLUGIN_VERSION: DEPENDENCY_VERSIONS.spinKubePlugin,
                    SPIN_TEMPLATES_TAG:  (version ? `spin/templates/v${ version.major }.${ version.minor }` : 'unknown'),
                  };
                  const wslenv = Object.keys(env).join(':');

                  // wsl-exec is needed to correctly resolve DNS names
                  await this.execCommand({
                    env: {
                      ...process.env, ...env, WSLENV: wslenv,
                    },
                  }, '/usr/local/bin/wsl-exec', await this.wslify(executable('setup-spin')));
                } catch {
                  // just ignore any errors; all the script does is installing spin plugins and templates
                }
              }
              // Do not await on this, as we don't want to wait until the proxy exits.
              this.runWslProxy().catch(console.error);
            }),
            this.progressTracker.action('Installing CA certificates', 100, this.installCACerts()),
            this.progressTracker.action('Installing helpers', 50, this.installWSLHelpers()),
          ]));

          if (kubernetesVersion) {
            const version = kubernetesVersion;
            const allPlatformsThresholdVersion = '1.31.0';

            // We install containerd-shims as part of the container engine installation (see
            // BackendHelper#installContainerdShims); and we need that to finish first so that when
            // we install Kubernetes, we can look up the set of shims in order to create
            // RuntimeClasses for them.  (See BackendHelper#configureRuntimeClasses.)
            await this.progressTracker.action('Installing Kubernetes', 0, Promise.all([
              this.progressTracker.action('Writing K3s configuration', 50, async() => {
                const k3sConf = {
                  PORT:                   config.kubernetes.port.toString(),
                  LOG_DIR:                await this.wslify(paths.logs),
                  'export IPTABLES_MODE': 'legacy',
                  ENGINE:                 config.containerEngine.name,
                  ADDITIONAL_ARGS:        config.kubernetes.options.traefik ? '' : '--disable traefik',
                  USE_CRI_DOCKERD:        BackendHelper.requiresCRIDockerd(config.containerEngine.name, version).toString(),
                  ALLPLATFORMS:           semver.lt(version, allPlatformsThresholdVersion) ? '--all-platforms' : '',
                };

                // Make sure the apiserver can be accessed from WSL through the internal gateway
                k3sConf.ADDITIONAL_ARGS += ' --tls-san gateway.rancher-desktop.internal';

                // Generate certificates for the statically defined host entries.
                // This is useful for users connecting to the host via HTTPS.
                k3sConf.ADDITIONAL_ARGS += ' --tls-san host.rancher-desktop.internal';
                k3sConf.ADDITIONAL_ARGS += ' --tls-san host.docker.internal';

                // Add the `veth-rd-ns` IP address from inside the namespace
                k3sConf.ADDITIONAL_ARGS += ' --tls-san 192.168.143.1';

                if (!config.kubernetes.options.flannel) {
                  console.log(`Disabling flannel and network policy`);
                  k3sConf.ADDITIONAL_ARGS += ' --flannel-backend=none --disable-network-policy';
                }
                if (config.application.debug) {
                  config.ADDITIONAL_ARGS += ' --debug';
                }

                await this.writeConf('k3s', k3sConf);
              }),
              this.progressTracker.action('Installing k3s', 100, async() => {
                await this.kubeBackend.deleteIncompatibleData(version);
                await this.kubeBackend.install(config, version, false);
              })]));
          }
        } finally {
          distroLock.kill('SIGTERM');
        }

        await this.progressTracker.action('Running provisioning scripts', 100, this.runProvisioningScripts());

        if (config.experimental.virtualMachine.proxy.enabled && config.experimental.virtualMachine.proxy.address && config.experimental.virtualMachine.proxy.port) {
          await this.progressTracker.action('Starting proxy', 100, this.startService('moproxy'));
        }
        if (config.containerEngine.allowedImages.enabled) {
          await this.progressTracker.action('Starting image proxy', 100, this.startService('rd-openresty'));
        }
        await this.progressTracker.action('Starting container engine', 0, this.startService(config.containerEngine.name === ContainerEngine.MOBY ? 'docker' : 'containerd'));

        switch (config.containerEngine.name) {
        case ContainerEngine.CONTAINERD:
          await this.progressTracker.action('Starting buildkit', 0,
            this.startService('buildkitd'));
          try {
            await this.execCommand({
              root:          true,
              expectFailure: true,
            },
            'ctr', '--address', '/run/k3s/containerd/containerd.sock', 'namespaces', 'create', 'default');
          } catch {
            // expecting failure because the namespace may already exist
          }
          this.#containerEngineClient = new NerdctlClient(this);
          break;
        case ContainerEngine.MOBY:
          this.#containerEngineClient = new MobyClient(this, 'npipe:////./pipe/docker_engine');
          break;
        }

        // Set the kubernetes ingress address to localhost only for
        // a non-admin installation, if it's not already set.
        if (!config.kubernetes.ingress.localhostOnly && !await this.getIsAdminInstall()) {
          this.writeSetting({ kubernetes: { ingress: { localhostOnly: true } } });
        }

        const tasks = [
          this.progressTracker.action('Waiting for container engine to be ready', 0, this.containerEngineClient.waitForReady()),
        ];

        if (kubernetesVersion) {
          tasks.push(this.progressTracker.action('Starting Kubernetes', 100, this.kubeBackend.start(config, kubernetesVersion)));
        }

        await Promise.all(tasks);

        await this.setState(config.kubernetes.enabled ? State.STARTED : State.DISABLED);
      } catch (ex) {
        await this.setState(State.ERROR);
        throw ex;
      } finally {
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
        const archiveFinished = util.promisify(stream.finished)(archive as any);

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
      await fs.promises.rm(workdir, { recursive: true, maxRetries: 3 });
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

        // Stop the service if it's already running for some reason.
        // This should never be the case (because we tore down init).
        await this.stopService('local');

        // Clobber /etc/local.d and replace it with a symlink to our desired
        // path.  This is needed as /etc/init.d/local does not support
        // overriding the script directory.
        await this.execCommand('rm', '-r', '-f', '/etc/local.d');
        await this.execCommand('ln', '-s', '-f', '-T', linuxPath, '/etc/local.d');

        // Ensure all scripts are executable; Windows mounts are unlikely to
        // have it set by default.
        await this.execCommand('/usr/bin/find',
          '/etc/local.d/',
          '(', '-name', '*.start', '-o', '-name', '*.stop', ')',
          '-print', '-exec', 'chmod', 'a+x', '{}', ';');

        // Run the script.
        await this.startService('local');
      })(),
    ]);
  }

  async stop(): Promise<void> {
    // When we manually call stop, the subprocess will terminate, which will
    // cause stop to get called again.  Prevent the reentrancy.
    // If we're in the middle of starting, also ignore the call to stop (from
    // the process terminating), as we do not want to shut down the VM in that
    // case.
    if (this.currentAction !== Action.NONE) {
      return;
    }
    this.currentAction = Action.STOPPING;
    try {
      await this.setState(State.STOPPING);
      await this.kubeBackend.stop();
      this.#containerEngineClient = undefined;

      await this.progressTracker.action('Shutting Down...', 10, async() => {
        if (await this.isDistroRegistered({ runningOnly: true })) {
          const services = ['k3s', 'docker', 'containerd', 'rd-openresty',
            'rancher-desktop-guestagent', 'buildkitd'];

          for (const service of services) {
            try {
              await this.stopService(service);
            } catch (ex) {
              // Do not allow errors here to prevent us from stopping.
              console.error(`Failed to stop service ${ service }:`, ex);
            }
          }
          try {
            await this.stopService('local');
          } catch (ex) {
            // Do not allow errors here to prevent us from stopping.
            console.error('Failed to run user provisioning scripts on stopping:', ex);
          }
        }
        const initProcess = this.process;

        this.process = null;
        if (initProcess) {
          initProcess.kill('SIGTERM');
          try {
            await this.execCommand({ expectFailure: true }, '/usr/bin/killall', '/usr/local/bin/network-setup');
          } catch (ex) {
            // `killall` returns failure if it fails to kill (e.g. if the
            // process does not exist); `-q` only suppresses printing any error
            // messages.
            console.error('Ignoring error shutting down network-setup:', ex);
          }
        }
        await this.hostSwitchProcess.stop();
        if (await this.isDistroRegistered({ runningOnly: true })) {
          await this.execWSL('--terminate', INSTANCE_NAME);
        }
      });
      await this.setState(State.STOPPED);
    } catch (ex) {
      await this.setState(State.ERROR);
      throw ex;
    } finally {
      this.currentAction = Action.NONE;
    }
  }

  async del(): Promise<void> {
    await this.progressTracker.action('Deleting Kubernetes', 20, async() => {
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

  async reset(config: BackendSettings): Promise<void> {
    await this.progressTracker.action('Resetting Kubernetes state...', 5, async() => {
      await this.stop();
      // Mount the data first so they can be deleted correctly.
      const distroLock = await this.mountData();

      try {
        await this.kubeBackend.reset();
      } finally {
        distroLock.kill('SIGTERM');
      }
      await this.start(config);
    });
  }

  async handleSettingsUpdate(newConfig: BackendSettings): Promise<void> {
    const proxy = newConfig.experimental.virtualMachine.proxy;

    await this.writeProxySettings(proxy);
    if (this.currentAction === Action.NONE && this.process) {
      if (proxy.enabled && proxy.address && proxy.port) {
        await this.execService('moproxy', 'reload', '--ifstarted');
        await this.startService('moproxy');
      } else {
        await this.stopService('moproxy');
      }
    }
  }

  // The WSL implementation of requiresRestartReasons doesn't need to do
  // anything asynchronously; however, to match the API, we still need to return
  // a Promise.
  requiresRestartReasons(cfg: RecursivePartial<BackendSettings>): Promise<RestartReasons> {
    if (!this.cfg) {
      // No need to restart if nothing exists
      return Promise.resolve({});
    }

    return Promise.resolve(this.kubeBackend.requiresRestartReasons(
      this.cfg, cfg));
  }

  /**
   * Return the Linux path to the WSL helper executable.
   */
  getWSLHelperPath(distro?: string): Promise<string> {
    // We need to get the Linux path to our helper executable; it is easier to
    // just get WSL to do the transformation for us.

    return this.wslify(executable('wsl-helper-linux'), distro);
  }

  async getFailureDetails(exception: any): Promise<FailureDetails> {
    const loglines = (await fs.promises.readFile(console.path, 'utf-8')).split('\n').slice(-10);

    return {
      lastCommand:        exception[childProcess.ErrorCommand],
      lastCommandComment: getProgressErrorDescription(exception) ?? 'Unknown',
      lastLogLines:       loglines,
    };
  }

  // #region Events
  eventNames(): (keyof BackendEvents)[] {
    return super.eventNames() as (keyof BackendEvents)[];
  }

  listeners<eventName extends keyof BackendEvents>(
    event: eventName,
  ): BackendEvents[eventName][] {
    return super.listeners(event) as BackendEvents[eventName][];
  }

  rawListeners<eventName extends keyof BackendEvents>(
    event: eventName,
  ): BackendEvents[eventName][] {
    return super.rawListeners(event) as BackendEvents[eventName][];
  }
  // #endregion
}
