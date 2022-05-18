// Kubernetes backend for macOS, based on Lima.

import crypto from 'crypto';
import events from 'events';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import stream from 'stream';
import timers from 'timers';
import util from 'util';
import { ChildProcess, spawn as spawnWithSignal } from 'child_process';

import merge from 'lodash/merge';
import semver from 'semver';
import sudo from 'sudo-prompt';
import tar from 'tar-stream';
import yaml from 'yaml';
import Electron from 'electron';

import K3sHelper, { ShortVersion } from './k3sHelper';
import ProgressTracker from './progressTracker';
import * as K8s from './k8s';
import { ContainerEngine, Settings } from '@/config/settings';
import * as childProcess from '@/utils/childProcess';
import Logging from '@/utils/logging';
import paths from '@/utils/paths';
import resources from '@/utils/resources';
import DEFAULT_CONFIG from '@/assets/lima-config.yaml';
import NETWORKS_CONFIG from '@/assets/networks-config.yaml';
import FLANNEL_CONFLIST from '@/assets/scripts/10-flannel.conflist';
import CONTAINERD_CONFIG from '@/assets/scripts/k3s-containerd-config.toml';
import DOCKER_CREDENTIAL_SCRIPT from '@/assets/scripts/docker-credential-rancher-desktop';
import SERVICE_CRI_DOCKERD_SCRIPT from '@/assets/scripts/service-cri-dockerd.initd';
import INSTALL_K3S_SCRIPT from '@/assets/scripts/install-k3s';
import SERVICE_K3S_SCRIPT from '@/assets/scripts/service-k3s.initd';
import LOGROTATE_K3S_SCRIPT from '@/assets/scripts/logrotate-k3s';
import SERVICE_BUILDKITD_INIT from '@/assets/scripts/buildkit.initd';
import SERVICE_BUILDKITD_CONF from '@/assets/scripts/buildkit.confd';
import mainEvents from '@/main/mainEvents';
import { getImageProcessor } from '@/k8s-engine/images/imageFactory';
import { KubeClient } from '@/k8s-engine/client';
import { openSudoPrompt } from '@/window';
import { getServerCredentialsPath, ServerState } from '@/main/credentialServer/httpCredentialHelperServer';

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
    arch?: 'x86_64' | 'aarch64';
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
  hostResolver?: {
    hosts?: Record<string, string>;
  }
  portForwards?: Array<Record<string, any>>;
  networks?: Array<Record<string, string>>;
  paths?: Record<string, string>;

  // The rest of the keys are not used by lima, just state we keep with the VM.
  k3s?: {
    version: string;
  }
}

/**
 * Lima networking configuration.
 * @see https://github.com/lima-vm/lima/blob/v0.8.0/pkg/networks/networks.go
 */
interface LimaNetworkConfiguration {
  paths: {
    vdeSwitch: string;
    vdeVMNet: string;
    varRun: string;
    sudoers?: string;
  }
  group?: string;
  networks: Record<string, {
    mode: 'host' | 'shared';
    gateway: string;
    dhcpEnd: string;
    netmask: string;
  } | {
    mode: 'bridged';
    interface: string;
  }>;
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

/** SPNetworkDataType is output from /usr/sbin/system_profiler on darwin. */
interface SPNetworkDataType {
  _name: string;
  interface: string;
  dhcp?: unknown;
  IPv4?: {
    Addresses?: string[];
  };
}

type SudoReason = 'networking' | 'docker-socket';

/**
 * SudoCommand describes an operation that will be run under sudo.  This is
 * returned from various methods that need to determine what commands we need to
 * run under sudo to have all functionality.
 */
interface SudoCommand {
  /** Reason why we want sudo access, */
  reason: SudoReason;
  /** Commands that will need to be executed. */
  commands: string[];
  /** Paths that will be affected by this command. */
  paths: string[];
}

const console = Logging.lima;
const DEFAULT_DOCKER_SOCK_LOCATION = '/var/run/docker.sock';
const MACHINE_NAME = '0';
const IMAGE_VERSION = '0.2.13';
const ALPINE_EDITION = 'rd';
const ALPINE_VERSION = '3.15.4';

/** The following files, and their parents up to /, must only be writable by root,
 *  and none of them are allowed to be symlinks (lima-vm requirements).
 */
const VDE_DIR = '/opt/rancher-desktop';

// Make this file the last one to be loaded by `sudoers` so others don't override needed settings.
// Details at https://github.com/rancher-sandbox/rancher-desktop/issues/1444
// This path introduced in version 1.0.1
const LIMA_SUDOERS_LOCATION = '/private/etc/sudoers.d/zzzzz-rancher-desktop-lima';
// Filename used in versions 1.0.0 and earlier:
const PREVIOUS_LIMA_SUDOERS_LOCATION = '/private/etc/sudoers.d/rancher-desktop-lima';

function defined<T>(input: T | null | undefined): input is T {
  return input !== null && typeof input !== 'undefined';
}

/**
 * LimaBackend implements all the Lima-specific functionality for Rancher
 * Desktop.  This is used on macOS and Linux.
 */
// Implementation note: some of the methods of this class do not need to modify
// the instance; these have an explicit this parameter [1] to narrow their view
// of the class instance.  Typically, they use Readonly<LimaBackend> to prevent
// writing to the instance; however, as that drops all non-public fields [2] we
// sometimes have to use Readonly<LimaBackend> & LimaBackend to pick them up
// (though this loses the type guarantees around it not modifying the instance).
// [1]: https://www.typescriptlang.org/docs/handbook/2/classes.html#this-parameters
// [2]: https://github.com/microsoft/TypeScript/issues/46802
export default class LimaBackend extends events.EventEmitter implements K8s.KubernetesBackend {
  constructor(arch: K8s.Architecture) {
    super();
    this.arch = arch;
    this.k3sHelper = new K3sHelper(arch);
    this.k3sHelper.on('versions-updated', () => this.emit('versions-updated'));
    this.k3sHelper.initialize().catch((err) => {
      console.log('k3sHelper.initialize failed: ', err);
    });
    mainEvents.on('network-ready', () => this.k3sHelper.networkReady());

    this.progressTracker = new ProgressTracker((progress) => {
      this.progress = progress;
      this.emit('progress');
    });

    if (!(process.env.NODE_ENV ?? '').includes('test')) {
      process.on('exit', async() => {
        // Attempt to shut down any stray qemu processes.
        await this.lima('stop', '--force', MACHINE_NAME);
      });
    }
  }

  protected readonly CONFIG_PATH = path.join(paths.lima, '_config', `${ MACHINE_NAME }.yaml`);

  protected cfg: Settings['kubernetes'] | undefined;

  /** The current architecture. */
  protected readonly arch: K8s.Architecture;

  /** The version of Kubernetes currently running. */
  protected activeVersion: semver.SemVer | null = null;

  /** The port Kubernetes is actively listening on. */
  protected currentPort = 0;

  /** The port the Kubernetes server _should_ listen on */
  #desiredPort = 6443;

  /** The current container engine; changing this requires a full restart. */
  #currentContainerEngine = ContainerEngine.NONE;

  /** True if start() was called with k3s enabled, false if it wasn't. */
  #enabledK3s = true;

  /** Whether we can prompt the user for administrative access - this setting persists in the config. */
  #allowSudo = true;

  /** A transient property that prevents prompting via modal UI elements. */
  #noModalDialogs = false;

  get noModalDialogs() {
    return this.#noModalDialogs;
  }

  set noModalDialogs(value: boolean) {
    this.#noModalDialogs = value;
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
  protected readonly k3sHelper: K3sHelper;

  protected client: K8s.Client | null = null;

  /** Helper object to manage progress notifications. */
  protected progressTracker;

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
    case K8s.State.DISABLED:
      this.client?.destroy();
    }
  }

  progress: K8s.KubernetesProgress = { current: 0, max: 0 };

  /** Process for tailing logs */
  protected logProcess: childProcess.ChildProcess | null = null;

  debug = false;

  emit: K8s.KubernetesBackend['emit'] = this.emit;

  get backend(): 'lima' {
    return 'lima';
  }

  get version(): ShortVersion {
    return this.activeVersion?.version ?? '';
  }

  get availableVersions(): Promise<K8s.VersionEntry[]> {
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

  get desiredPort() {
    return this.#desiredPort;
  }

  protected async ensureArchitectureMatch() {
    if (os.platform().startsWith('darwin')) {
      // Normally, `file` command returns "... executable arm64" or "... executable x86_64"
      // But if there are problems reading the file, `file' follows the POSIX spec, writes its
      // error message to stdout, and returns exit code 0 (overridable with a `-E` flag on newer
      // versions of macos). Best to do our own check before invoking `file':
      try {
        await fs.promises.access(LimaBackend.limactl, fs.constants.R_OK);
      } catch (err: any) {
        switch (err.code) {
        case 'ENOENT':
          throw new K8s.KubernetesError('Fatal Error', `File ${ LimaBackend.limactl } doesn't exist.`, true);
        case 'EACCES':
          throw new K8s.KubernetesError('Fatal Error', `File ${ LimaBackend.limactl } isn't readable.`, true);
        default:
          throw new K8s.KubernetesError('Fatal Error', `Error trying to analyze file ${ LimaBackend.limactl }: ${ err }`, true);
        }
      }
      const expectedArch = this.arch === 'aarch64' ? 'arm64' : this.arch;
      const { stdout } = await childProcess.spawnFile(
        'file', [LimaBackend.limactl],
        { stdio: ['inherit', 'pipe', console] });

      if (!stdout.includes(`executable ${ expectedArch }`)) {
        /* Using 'aarch64' and 'x86_64' in the error because that's what we use for the DMG suffix, e.g. "Rancher Desktop.aarch64.dmg" */
        const otherArch = { aarch64: 'x86_64', x86_64: 'aarch64' }[this.arch];

        throw new K8s.KubernetesError('Fatal Error', `Rancher Desktop for ${ otherArch } does not work on ${ this.arch }.`, true);
      }
    }
  }

  protected async ensureVirtualizationSupported() {
    if (os.platform().startsWith('linux')) {
      const { stdout } = await childProcess.spawnFile(
        'cat', ['/proc/cpuinfo'],
        { stdio: ['inherit', 'pipe', console] });

      if (!/flags.*(vmx|svm)/g.test(stdout.trim())) {
        console.log(`Virtualization support error: got ${ stdout.trim() }`);
        throw new Error('Virtualization does not appear to be supported on your machine.');
      }
    } else if (os.platform().startsWith('darwin')) {
      const { stdout } = await childProcess.spawnFile(
        'sysctl', ['kern.hv_support'],
        { stdio: ['inherit', 'pipe', console] });

      if (!/:\s*1$/.test(stdout.trim())) {
        console.log(`Virtualization support error: got ${ stdout.trim() }`);
        throw new Error('Virtualization does not appear to be supported on your machine.');
      }
    }
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

      // Assume any of the addresses works to connect to the apiserver, so pick the first one.
      return addresses[0];
    })();
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

  getBackendInvalidReason(): Promise<K8s.KubernetesError | null> {
    return Promise.resolve(null);
  }

  /**
   * Check if the base (alpine) disk image is out of date; if yes, update it
   * without removing existing data.  This is only ever called from updateConfig
   * to ensure that the passed-in lima configuration is the one before we
   * overwrote it.
   *
   * This will stop the VM if necessary.
   */
  protected async updateBaseDisk(currentConfig: LimaConfiguration) {
    // Lima does not have natively have any support for this; we'll need to
    // reach into the configuration and:
    // 1) Figure out what the old base disk version is.
    // 2) Confirm that it's out of date.
    // 3) Change out the base disk as necessary.
    // Unfortunately, we don't have a version string anywhere _in_ the image, so
    // we will have to rely on the path in lima.yml instead.

    const images = currentConfig.images.map(i => path.basename(i.location));
    // We had a typo in the name of the image; it was "alpline" instead of "alpine".
    const versionMatch = images.map(i => /^alpl?ine-lima-v([0-9.]+)-/.exec(i)).find(defined);
    const existingVersion = semver.coerce(versionMatch ? versionMatch[1] : null);

    if (!existingVersion) {
      console.log(`Could not find base image version from ${ images }; skipping update of base images.`);

      return;
    }

    const versionComparison = semver.coerce(IMAGE_VERSION)?.compare(existingVersion);

    switch (versionComparison) {
    case undefined:
      // Could not parse desired image version
      console.log(`Error parsing desired image version ${ IMAGE_VERSION }`);

      return;
    case -1: {
      // existing version is newer
      const message = `
          This Rancher Desktop installation appears to be older than the version
          that created your existing Kubernetes cluster.  Please either update
          Rancher Desktop or reset Kubernetes and container images.`;

      console.log(`Base disk is ${ existingVersion }, newer than ${ IMAGE_VERSION } - aborting.`);
      throw new K8s.KubernetesError('Rancher Desktop Update Required', message.replace(/\s+/g, ' ').trim());
    }
    case 0:
      // The image is the same version as what we have
      return;
    case 1:
      // Need to update the image.
      break;
    default: {
      // Should never reach this.
      const message = `
        There was an error determining if your existing Rancher Desktop cluster
        needs to be updated.  Please reset Kubernetes and container images, or
        file an issue with your Rancher Desktop logs attached.`;

      console.log(`Invalid valid comparing ${ existingVersion } to desired ${ IMAGE_VERSION }: ${ JSON.stringify(versionComparison) }`);

      throw new K8s.KubernetesError('Fatal Error', message.replace(/\s+/g, ' ').trim());
    }
    }

    console.log(`Attempting to update base image from ${ existingVersion } to ${ IMAGE_VERSION }...`);

    if ((await this.status)?.status === 'Running') {
      // This shouldn't be possible (it should only be running if we started it
      // in the same Rancher Desktop instance); but just in case, we still stop
      // the VM anyway.
      await this.lima('stop', MACHINE_NAME);
    }

    const diskPath = path.join(paths.lima, MACHINE_NAME, 'basedisk');

    await fs.promises.copyFile(this.baseDiskImage, diskPath);
    // The config file will be updated in updateConfig() instead; no need to do it here.
    console.log(`Base image successfully updated.`);
  }

  protected get baseDiskImage() {
    const imageName = `alpine-lima-v${ IMAGE_VERSION }-${ ALPINE_EDITION }-${ ALPINE_VERSION }.iso`;

    return path.join(paths.resources, os.platform(), imageName);
  }

  #sshPort = 0;
  get sshPort(): Promise<number> {
    return (async() => {
      if (this.#sshPort === 0) {
        if ((await this.status)?.status === 'Running') {
          // if the machine is already running, we can't change the port.
          const existingPort = (await this.currentConfig)?.ssh.localPort;

          if (existingPort) {
            this.#sshPort = existingPort;

            return existingPort;
          }
        }

        const server = net.createServer();

        await new Promise((resolve) => {
          server.once('listening', resolve);
          server.listen(0, '127.0.0.1');
        });
        this.#sshPort = (server.address() as net.AddressInfo).port;
        server.close();
      }

      return this.#sshPort;
    })();
  }

  /**
   * Update the Lima configuration.  This may stop the VM if the base disk image
   * needs to be changed.
   */
  protected async updateConfig(desiredVersion: semver.SemVer | undefined, allowRoot = true) {
    const currentConfig = await this.currentConfig;
    const baseConfig: Partial<LimaConfiguration> = currentConfig || {};
    // We use {} as the first argument because merge() modifies
    // it, and it would be less safe to modify baseConfig.
    const config: LimaConfiguration = merge({}, baseConfig, DEFAULT_CONFIG as LimaConfiguration, {
      images: [{
        location: this.baseDiskImage,
        arch:     this.arch,
      }],
      cpus:   this.cfg?.numberCPUs || 4,
      memory: (this.cfg?.memoryInGB || 4) * 1024 * 1024 * 1024,
      mounts: [
        { location: path.join(paths.cache, 'k3s'), writable: false },
        { location: '~', writable: true },
        { location: '/tmp/rancher-desktop', writable: true },
      ],
      ssh:          { localPort: await this.sshPort },
      hostResolver: {
        hosts: {
          // As far as lima is concerned, the instance name is 'lima-0'.
          // We change the hostname in a provisioning script.
          'lima-rancher-desktop':          'lima-0',
          'host.rancher-desktop.internal': 'host.lima.internal',
          'host.docker.internal':          'host.lima.internal',
        }
      }
    });

    if (desiredVersion) {
      config.k3s = { version: desiredVersion.version };
    } else if (!config.k3s?.version) {
      // We can reach here if we're on initial startup, but regenerating the config due to a lack of
      // sudo permissions.  Read the version out of the previously generated file.
      const previousConfigRaw = await fs.promises.readFile(this.CONFIG_PATH, 'utf-8');
      const previousConfig: LimaConfiguration = yaml.parse(previousConfigRaw);

      config.k3s = previousConfig.k3s;
    }

    if (os.platform() === 'darwin') {
      if (allowRoot) {
        const hostNetwork = (await this.getDarwinHostNetworks()).find((n) => {
          return n.dhcp && n.IPv4?.Addresses?.some(addr => addr);
        });

        // Always add a shared network interface in case the bridged interface doesn't get an IP address.
        config.networks = [{
          lima:      'rancher-desktop-shared',
          interface: 'rd1',
        }];
        if (hostNetwork) {
          config.networks.push({
            lima:      `rancher-desktop-bridged_${ hostNetwork.interface }`,
            interface: 'rd0',
          });
        } else {
          console.log('Could not find any acceptable host networks for bridging.');
        }
      } else {
        console.log('Administrator access disallowed, not using vde_vmnet.');
        delete config.networks;
      }
    }

    this.updateConfigPortForwards(config);
    if (currentConfig) {
      // update existing configuration
      const configPath = path.join(paths.lima, MACHINE_NAME, 'lima.yaml');

      this.lastCommandComment = 'Updating outdated virtual machine';
      await this.progressTracker.action(
        this.lastCommandComment,
        100,
        this.updateBaseDisk(currentConfig)
      );
      await fs.promises.writeFile(configPath, yaml.stringify(config), 'utf-8');
    } else {
      // new configuration
      await fs.promises.mkdir(path.dirname(this.CONFIG_PATH), { recursive: true });
      await fs.promises.writeFile(this.CONFIG_PATH, yaml.stringify(config));
      if (os.platform().startsWith('darwin')) {
        try {
          await childProcess.spawnFile('tmutil', ['addexclusion', paths.lima]);
        } catch (ex) {
          console.log('Failed to add exclusion to TimeMachine', ex);
        }
      }
    }
  }

  protected updateConfigPortForwards(config: LimaConfiguration) {
    let allPortForwards: Array<Record<string, any>> | undefined = config.portForwards;

    if (!allPortForwards) {
      // This shouldn't happen, but fix it anyway
      config.portForwards = allPortForwards = DEFAULT_CONFIG.portForwards ?? [];
    }
    const hostSocket = path.join(paths.altAppHome, 'docker.sock');
    const dockerPortForwards = allPortForwards?.find(entry => Object.keys(entry).length === 2 &&
      entry.guestSocket === '/var/run/docker.sock' &&
      ('hostSocket' in entry));

    if (!dockerPortForwards) {
      config.portForwards?.push({
        guestSocket: '/var/run/docker.sock',
        hostSocket,
      });
    } else {
      dockerPortForwards.hostSocket = hostSocket;
    }
  }

  protected get currentConfig(): Promise<LimaConfiguration | undefined> {
    return (async() => {
      try {
        const configPath = path.join(paths.lima, MACHINE_NAME, 'lima.yaml');
        const configRaw = await fs.promises.readFile(configPath, 'utf-8');

        return yaml.parse(configRaw) as LimaConfiguration;
      } catch (ex) {
        if ((ex as NodeJS.ErrnoException).code === 'ENOENT') {
          return undefined;
        }
      }
    })();
  }

  protected static get limactl() {
    return path.join(paths.resources, os.platform(), 'lima', 'bin', 'limactl');
  }

  protected static get limaEnv() {
    const binDir = path.join(paths.resources, os.platform(), 'lima', 'bin');
    const vdeDir = path.join(VDE_DIR, 'bin');
    const pathList = (process.env.PATH || '').split(path.delimiter);
    const newPath = [binDir, vdeDir].concat(...pathList).filter(x => x);

    return {
      ...process.env, LIMA_HOME: paths.lima, PATH: newPath.join(path.delimiter)
    };
  }

  /**
   * Run `limactl` with the given arguments.
   */
  protected async lima(this: Readonly<this>, ...args: string[]): Promise<void> {
    args = this.debug ? ['--debug'].concat(args) : args;
    try {
      await childProcess.spawnFile(LimaBackend.limactl, args,
        { env: LimaBackend.limaEnv, stdio: console });
    } catch (ex) {
      console.error(`+ limactl ${ args.join(' ') }`);
      console.error(ex);
      throw ex;
    }
  }

  /**
   * Run `limactl` with the given arguments, and return stdout.
   */
  protected async limaWithCapture(this: Readonly<this>, ...args: string[]): Promise<string> {
    args = this.debug ? ['--debug'].concat(args) : args;
    const { stdout } = await childProcess.spawnFile(LimaBackend.limactl, args,
      { env: LimaBackend.limaEnv, stdio: ['ignore', 'pipe', console] });

    return stdout;
  }

  /**
   * Run the given command within the VM.
   */
  limaSpawn(args: string[]): ChildProcess {
    args = ['shell', '--workdir=.', MACHINE_NAME].concat(args);
    args = this.debug ? ['--debug'].concat(args) : args;

    return spawnWithSignal(LimaBackend.limactl, args, { env: LimaBackend.limaEnv });
  }

  protected async ssh(...args: string[]): Promise<void> {
    await this.lima('shell', '--workdir=.', MACHINE_NAME, ...args);
  }

  /**
   * Get the current Lima VM status, or undefined if there was an error
   * (e.g. the machine is not registered).
   */
  protected get status(): Promise<LimaListResult | undefined> {
    return (async() => {
      try {
        const text = await this.limaWithCapture('list', '--json');
        const lines = text.split(/\r?\n/).filter(x => x.trim());
        const entries = lines.map(line => JSON.parse(line) as LimaListResult);

        return entries.find(entry => entry.name === MACHINE_NAME);
      } catch (ex) {
        console.error('Could not parse lima status, assuming machine is unavailable.');

        return undefined;
      }
    })();
  }

  protected get isRegistered(): Promise<boolean> {
    return this.status.then(defined);
  }

  private static calcRandomTag(desiredLength: number) {
    // quicker to use Math.random() than pull in all the dependencies utils/string:randomStr wants
    return Math.random().toString().substring(2, desiredLength + 2);
  }

  /**
   * Show the dialog box describing why sudo is required.
   *
   * @param explanations Map of why we want sudo, and what files are affected.
   * @return Whether the user wants to allow the prompt.
   */
  protected async showSudoReason(this: Readonly<this> & this, explanations: Record<string, string[]>): Promise<boolean> {
    if (this.noModalDialogs || this.cfg?.suppressSudo) {
      return false;
    }
    const neverAgain = await openSudoPrompt(explanations);

    if (neverAgain && this.cfg) {
      this.cfg.suppressSudo = true;
      mainEvents.emit('settings-write', { kubernetes: { suppressSudo: true } });

      return false;
    }

    return true;
  }

  /**
   * Run the various commands that require privileged access after prompting the
   * user about the details.
   *
   * @returns Whether privileged access was successful; this will also be true
   *          if no privileged access was required.
   * @note This may request the root password.
   */
  protected async installToolsWithSudo(): Promise<boolean> {
    const randomTag = LimaBackend.calcRandomTag(8);
    const commands: Array<string> = [];
    const explanations: Partial<Record<SudoReason, string[]>> = {};

    const processCommand = (cmd: SudoCommand | undefined) => {
      if (cmd) {
        commands.push(...cmd.commands);
        explanations[cmd.reason] = (explanations[cmd.reason] ?? []).concat(...cmd.paths);
      }
    };

    if (os.platform() === 'darwin') {
      await this.progressTracker.action(this.lastCommandComment, 10, async() => {
        this.lastCommandComment = 'Setting up virtual ethernet';
        processCommand(await this.installVDETools());
      });
      this.lastCommandComment = 'Setting Lima permissions';
      await this.progressTracker.action(this.lastCommandComment, 10, async() => {
        processCommand(await this.ensureRunLimaLocation());
        processCommand(await this.createLimaSudoersFile(randomTag));
      });
    }
    this.lastCommandComment = 'Setting up Docker socket';
    await this.progressTracker.action(this.lastCommandComment, 10, async() => {
      processCommand(await this.configureDockerSocket());
    });

    if (commands.length === 0) {
      return true;
    }

    this.lastCommandComment = 'Expecting user permission to continue';
    const allowed = await this.progressTracker.action(
      this.lastCommandComment,
      10,
      this.showSudoReason(explanations));

    if (!allowed) {
      return false;
    }

    const singleCommand = commands.join('; ');

    if (singleCommand.includes("'")) {
      throw new Error(`Can't execute commands ${ singleCommand } because there's a single-quote in them.`);
    }
    try {
      await this.sudoExec(`/bin/sh -xec '${ singleCommand }'`);
    } catch (err) {
      if (err instanceof Error && err.message === 'User did not grant permission.') {
        this.#allowSudo = false;
        console.error('Failed to execute sudo, falling back to unprivileged operation', err);

        return false;
      }
      throw err;
    }

    return true;
  }

  /**
   * Determine the commands required to install VDE-related tools.
   */
  protected async installVDETools(this: unknown): Promise<SudoCommand | undefined> {
    const sourcePath = path.join(paths.resources, os.platform(), 'lima', 'vde');
    const installedPath = VDE_DIR;
    const walk = async(dir: string): Promise<[string[], string[]]> => {
      const fullPath = path.resolve(sourcePath, dir);
      const entries = await fs.promises.readdir(fullPath, { withFileTypes: true });
      const directories: string[] = [];
      const files: string[] = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const [childDirs, childFiles] = await walk(path.join(dir, entry.name));

          directories.push(path.join(dir, entry.name), ...childDirs);
          files.push(...childFiles);
        } else if (entry.isFile() || entry.isSymbolicLink()) {
          files.push(path.join(dir, entry.name));
        } else {
          const childPath = path.join(fullPath, entry.name);

          console.error(`vmnet: Skipping unexpected file ${ childPath }`);
        }
      }

      return [directories, files];
    };
    const [directories, files] = await walk('.');
    const hashesMatch = await Promise.all(files.map(async(relPath) => {
      const hashFile = async(fullPath: string) => {
        const hash = crypto.createHash('sha256');

        await new Promise((resolve) => {
          const readStream = fs.createReadStream(fullPath);

          // On error, resolve to anything that won't match the expected hash;
          // this will trigger a copy. Using the full path is good enough here.
          hash.on('finish', resolve);
          hash.on('error', () => resolve(fullPath));
          readStream.on('error', () => resolve(fullPath));
          readStream.pipe(hash);
        });

        return hash.digest('hex');
      };
      const sourceFile = path.normalize(path.join(sourcePath, relPath));
      const installedFile = path.normalize(path.join(installedPath, relPath));
      const [sourceHash, installedHash] = await Promise.all([
        hashFile(sourceFile), hashFile(installedFile)
      ]);

      return sourceHash === installedHash;
    }));

    if (hashesMatch.every(matched => matched)) {
      return;
    }

    const workdir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rd-vde-install'));
    const tarPath = path.join(workdir, 'vde_vmnet.tar');
    const commands: string[] = [];

    try {
      // Actually create the tar file using all the files, not just the
      // outdated ones, since we're going to need a prompt anyway.
      const tarStream = fs.createWriteStream(tarPath);
      const archive = tar.pack();
      const archiveFinished = util.promisify(stream.finished)(archive);
      const newEntry = util.promisify(archive.entry.bind(archive));
      const baseHeader: Partial<tar.Headers> = {
        mode:  0o755,
        uid:   0,
        uname: 'root',
        gname: 'wheel',
        type:  'directory',
      };

      archive.pipe(tarStream);

      await newEntry({
        ...baseHeader,
        name: path.basename(installedPath)
      });
      for (const relPath of directories) {
        const info = await fs.promises.lstat(path.join(sourcePath, relPath));

        await newEntry({
          ...baseHeader,
          name:  path.normalize(path.join(path.basename(installedPath), relPath)),
          mtime: info.mtime,
        });
      }
      for (const relPath of files) {
        const source = path.join(sourcePath, relPath);
        const info = await fs.promises.lstat(source);
        const header: tar.Headers = {
          ...baseHeader,
          name:  path.normalize(path.join(path.basename(installedPath), relPath)),
          mode:  info.mode,
          mtime: info.mtime,
        };

        if (info.isSymbolicLink()) {
          header.type = 'symlink';
          header.linkname = await fs.promises.readlink(source);
          await newEntry(header);
        } else {
          header.type = 'file';
          header.size = info.size;
          const entry = archive.entry(header);
          const readStream = fs.createReadStream(source);
          const entryFinished = util.promisify(stream.finished)(entry);

          readStream.pipe(entry);
          await entryFinished;
        }
      }

      archive.finalize();
      await archiveFinished;
      const command = `tar -xf "${ tarPath }" -C "${ path.dirname(installedPath) }"`;

      console.log(`VDE tools install required: ${ command }`);
      commands.push(command);
    } finally {
      commands.push(`rm -fr ${ workdir }`);
    }

    return {
      reason: 'networking',
      commands,
      paths:  [VDE_DIR],
    };
  }

  protected async createLimaSudoersFile(this: Readonly<this> & this, randomTag: string): Promise<SudoCommand | undefined> {
    const haveFiles: Record<string, boolean> = {};

    for (const path of [PREVIOUS_LIMA_SUDOERS_LOCATION, LIMA_SUDOERS_LOCATION]) {
      try {
        await fs.promises.access(path);
        haveFiles[path] = true;
      } catch (err: any) {
        if (err.code === 'ENOENT') {
          haveFiles[path] = false;
        } else {
          throw new Error(`Can't test for ${ path }: err`);
        }
      }
    }
    if (haveFiles[LIMA_SUDOERS_LOCATION] && !haveFiles[PREVIOUS_LIMA_SUDOERS_LOCATION]) {
      // The name of the sudoer file is up-to-date. Return if `sudoers --check` is ok
      try {
        await this.lima('sudoers', '--check');

        return;
      } catch {
      }
    }
    // Here we have to run `lima sudoers` as non-root and grab the output, and then
    // copy it to the target sudoers file as root
    const data = await this.limaWithCapture('sudoers');
    const tmpFile = path.join(os.tmpdir(), `rd-sudoers${ randomTag }.txt`);
    const commands: string[] = [];
    const paths: string[] = [LIMA_SUDOERS_LOCATION];

    await fs.promises.writeFile(tmpFile, data.toString(), { mode: 0o644 });
    console.log(`need to limactl sudoers, get data from ${ tmpFile }`);
    commands.push(`cp "${ tmpFile }" ${ LIMA_SUDOERS_LOCATION } && rm -f "${ tmpFile }"`);
    if (haveFiles[PREVIOUS_LIMA_SUDOERS_LOCATION]) {
      commands.push(`rm -f ${ PREVIOUS_LIMA_SUDOERS_LOCATION }`);
      paths.push(PREVIOUS_LIMA_SUDOERS_LOCATION);
    }

    return {
      reason: 'networking',
      commands,
      paths,
    };
  }

  protected async ensureRunLimaLocation(this: unknown): Promise<SudoCommand | undefined> {
    const limaRunLocation: string = NETWORKS_CONFIG.paths.varRun;
    const commands: string[] = [];
    let dirInfo: fs.Stats | null;

    try {
      dirInfo = await fs.promises.stat(limaRunLocation);

      // If it's owned by root and not readable by others, it's fine
      if (dirInfo.uid === 0 && (dirInfo.mode & fs.constants.S_IWOTH) === 0) {
        return;
      }
    } catch (err) {
      dirInfo = null;
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.log(`Unexpected situation with ${ limaRunLocation }, stat => error ${ err }`, err);
        throw err;
      }
    }
    if (!dirInfo) {
      commands.push(`mkdir -p ${ limaRunLocation }`);
      commands.push(`chmod 755 ${ limaRunLocation }`);
    }
    commands.push(`chown -R root:daemon ${ limaRunLocation }`);
    commands.push(`chmod -R o-w ${ limaRunLocation }`);

    return {
      reason: 'networking',
      commands,
      paths:  [limaRunLocation],
    };
  }

  protected async configureDockerSocket(this: Readonly<this> & this): Promise<SudoCommand | undefined> {
    if (this.#currentContainerEngine !== ContainerEngine.MOBY) {
      return;
    }
    const realPath = await this.evalSymlink(DEFAULT_DOCKER_SOCK_LOCATION);
    const targetPath = path.join(paths.altAppHome, 'docker.sock');

    if (realPath === targetPath) {
      return;
    }

    return {
      reason:   'docker-socket',
      commands: [`ln -sf "${ targetPath }" "${ DEFAULT_DOCKER_SOCK_LOCATION }"`],
      paths:    [DEFAULT_DOCKER_SOCK_LOCATION],
    };
  }

  protected async evalSymlink(this: Readonly<this>, path: string): Promise<string> {
    // Use lstat.isSymbolicLink && readlink(path) to walk symlinks,
    // instead of fs.readlink(file) to show both where a symlink is
    // supposed to point, whether or not the referent exists right now.
    // Do this because the lima docker.sock (the referent) is deleted when lima shuts down.
    // Most of the time /var/run/docker.sock points directly to the lima socket, but
    // this code allows intermediate symlinks.
    try {
      while ((await fs.promises.lstat(path)).isSymbolicLink()) {
        path = await fs.promises.readlink(path);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.log(`Error trying to resolve symbolic link ${ path }:`, err);
      }
    }

    return path;
  }

  /**
   * Use the sudo-prompt library to run the script as root
   * @param command: Path to an executable file
   */
  protected async sudoExec(this: unknown, command: string) {
    await new Promise<void>((resolve, reject) => {
      const iconPath = path.join(paths.resources, 'icons', 'logo-square-512.png');

      sudo.exec(command, { name: 'Rancher Desktop', icns: iconPath }, (error, stdout, stderr) => {
        if (stdout) {
          console.log(`Prompt for sudo: stdout: ${ stdout }`);
        }
        if (stderr) {
          console.log(`Prompt for sudo: stderr: ${ stderr }`);
        }
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Provide a default network config file with rancher-desktop specific settings.
   *
   * If there's an existing file, replace it if it doesn't contain a
   * paths.varRun setting for rancher-desktop
   */
  protected async installCustomLimaNetworkConfig(allowRoot = true) {
    const networkPath = path.join(paths.lima, '_config', 'networks.yaml');

    let config: LimaNetworkConfiguration;

    try {
      config = yaml.parse(await fs.promises.readFile(networkPath, 'utf8'));
      if (config?.paths?.varRun !== NETWORKS_CONFIG.paths.varRun) {
        const backupName = networkPath.replace(/\.yaml$/, '.orig.yaml');

        await fs.promises.rename(networkPath, backupName);
        console.log(`Lima network configuration has unexpected contents; existing file renamed as ${ backupName }.`);
        config = NETWORKS_CONFIG;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.log(`Existing networks.yaml file ${ networkPath } not yaml-parsable, got error ${ err }. It will be replaced.`);
      }
      config = NETWORKS_CONFIG;
    }

    if (config.group === 'staff') {
      config.group = 'everyone';
    }

    for (const key of Object.keys(config.networks)) {
      if (key.startsWith('rancher-desktop-bridged_')) {
        delete config.networks[key];
      }
    }

    if (allowRoot) {
      for (const hostNetwork of await this.getDarwinHostNetworks()) {
        // Indiscriminately add all host networks, whether they _currently_ have
        // DHCP / IPv4 addresses.
        if (hostNetwork.interface) {
          config.networks[`rancher-desktop-bridged_${ hostNetwork.interface }`] = {
            mode:      'bridged',
            interface: hostNetwork.interface,
          };
        }
      }
      const sudoersPath = config.paths.sudoers;

      // Explanation of this rename at definition of PREVIOUS_LIMA_SUDOERS_LOCATION
      if (!sudoersPath || sudoersPath === PREVIOUS_LIMA_SUDOERS_LOCATION) {
        config.paths.sudoers = LIMA_SUDOERS_LOCATION;
      }
    } else {
      delete config.paths.sudoers;
    }

    await fs.promises.writeFile(networkPath, yaml.stringify(config), { encoding: 'utf-8' });
  }

  /**
   * Get host networking information on a darwin system.
   */
  protected async getDarwinHostNetworks(): Promise<SPNetworkDataType[]> {
    const { stdout } = await childProcess.spawnFile('/usr/sbin/system_profiler',
      ['SPNetworkDataType', '-json', '-detailLevel', 'basic'],
      { stdio: ['ignore', 'pipe', console] });

    return JSON.parse(stdout).SPNetworkDataType;
  }

  /**
   * Install K3s into the VM for execution.
   * @param version The version to install.
   */
  protected async installK3s(version: semver.SemVer) {
    const workdir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rd-k3s-install-'));

    try {
      const scriptPath = path.join(workdir, 'install-k3s');
      const k3s = this.arch === 'aarch64' ? 'k3s-arm64' : 'k3s';

      await fs.promises.writeFile(scriptPath, INSTALL_K3S_SCRIPT, { encoding: 'utf-8' });
      await this.ssh('mkdir', '-p', 'bin');
      await this.lima('copy', scriptPath, `${ MACHINE_NAME }:bin/install-k3s`);
      await this.ssh('chmod', 'a+x', 'bin/install-k3s');
      if (this.#enabledK3s) {
        await fs.promises.chmod(path.join(paths.cache, 'k3s', version.raw, k3s), 0o755);
        await this.ssh('sudo', 'bin/install-k3s', version.raw, path.join(paths.cache, 'k3s'));
      }
      const profilePath = path.join(paths.resources, 'scripts', 'profile');

      await this.lima('copy', profilePath, `${ MACHINE_NAME }:~/.profile`);
    } finally {
      await fs.promises.rm(workdir, { recursive: true });
    }
  }

  protected async configureContainerd(): Promise<void> {
    const workdir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rd-containerd-install-'));

    try {
      const profilePath = path.join(paths.resources, 'scripts', 'profile');

      await this.lima('copy', profilePath, `${ MACHINE_NAME }:~/.profile`);

      await this.ssh('sudo', 'mkdir', '-p', '/etc/cni/net.d');

      if (this.cfg?.options.flannel) {
        await this.writeFile('/etc/cni/net.d/10-flannel.conflist', FLANNEL_CONFLIST);
      }
      await this.writeFile('/etc/containerd/config.toml', CONTAINERD_CONFIG);
    } catch (err) {
      console.log(`Error trying to start/update containerd: ${ err }: `, err);
    } finally {
      await fs.promises.rm(workdir, { recursive: true });
    }
  }

  /**
   * Write the given contents to a given file name in the VM.
   * The file will be owned by root.
   * @param filePath The destination file path, in the VM.
   * @param fileContents The contents of the file.
   * @param permissions The file permissions.
   */
  protected async writeFile(filePath: string, fileContents: string, permissions: fs.Mode = 0o644) {
    const workdir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `rd-${ path.basename(filePath) }-`));
    const tempPath = `/tmp/${ path.basename(workdir) }.${ path.basename(filePath) }`;

    try {
      const scriptPath = path.join(workdir, path.basename(filePath));

      await fs.promises.writeFile(scriptPath, fileContents, 'utf-8');
      await this.lima('copy', scriptPath, `${ MACHINE_NAME }:${ tempPath }`);
      await this.ssh('chmod', permissions.toString(8), tempPath);
      await this.ssh('sudo', 'mv', tempPath, filePath);
    } finally {
      await fs.promises.rm(workdir, { recursive: true });
      await this.ssh('sudo', 'rm', '-f', tempPath);
    }
  }

  /**
   * Get IPv4 address for specified interface.
   */
  protected async getInterfaceAddr(iface: string) {
    try {
      const ipAddr = await this.limaWithCapture('shell', '--workdir=.', MACHINE_NAME,
        'ip', '--family', 'inet', 'addr', 'show', iface);
      const match = ipAddr.match(' inet ([0-9.]+)');

      return match ? match[1] : '';
    } catch (ex: any) {
      console.error(`Could not get address for ${ iface }: ${ ex?.stderr || ex }`);

      return '';
    }
  }

  /**
   * Display dialog to explain that bridged networking is not available.
   */
  protected noBridgedNetworkDialog(sharedIP: string) {
    const options: Electron.NotificationConstructorOptions = {
      title: 'Bridged network did not get an IP address.',
      body:  `Using shared network address ${ sharedIP }`,
      icon:  'info',
    };

    if (!sharedIP) {
      options.body = "Shared network isn't available either. Only network access is via port forwarding to the host.";
    }

    this.emit('show-notification', options);

    return Promise.resolve();
  }

  /**
   * Write the openrc script for k3s.
   */
  protected async writeServiceScript() {
    const config: Record<string, string> = {
      PORT:            this.desiredPort.toString(),
      ENGINE:          this.#currentContainerEngine,
      ADDITIONAL_ARGS: '',
    };

    if (this.#allowSudo && os.platform() === 'darwin') {
      if (this.cfg?.options.flannel) {
        const bridgedIP = await this.getInterfaceAddr('rd0');

        if (bridgedIP) {
          config.ADDITIONAL_ARGS += '--flannel-iface rd0';
          console.log(`Using ${ bridgedIP } on bridged network rd0`);
        } else {
          const sharedIP = await this.getInterfaceAddr('rd1');

          await this.noBridgedNetworkDialog(sharedIP);
          if (sharedIP) {
            config.ADDITIONAL_ARGS += '--flannel-iface rd1';
            console.log(`Using ${ sharedIP } on shared network rd1`);
          } else {
            config.ADDITIONAL_ARGS += '--flannel-iface eth0';
            console.log(`Neither bridged network rd0 nor shared network rd1 have an IPv4 address`);
          }
        }
      } else {
        console.log(`Disabling flannel and network policy`);
        config.ADDITIONAL_ARGS += '--flannel-backend=none --disable-network-policy';
      }
    }
    if (!this.cfg?.options.traefik) {
      config.ADDITIONAL_ARGS += ' --disable traefik';
    }
    await this.writeFile('/etc/init.d/cri-dockerd', SERVICE_CRI_DOCKERD_SCRIPT, 0o755);
    await this.writeConf('cri-dockerd', {
      LOG_DIR:         paths.logs,
      ENGINE:          this.#currentContainerEngine,
    });
    await this.writeFile('/etc/init.d/k3s', SERVICE_K3S_SCRIPT, 0o755);
    await this.writeConf('k3s', config);
    await this.writeFile('/etc/logrotate.d/k3s', LOGROTATE_K3S_SCRIPT);
  }

  protected async writeBuildkitScripts() {
    await this.writeFile(`/etc/init.d/buildkitd`, SERVICE_BUILDKITD_INIT, 0o755);
    await this.writeFile(`/etc/conf.d/buildkitd`, SERVICE_BUILDKITD_CONF, 0o644);
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

  protected async installTrivy() {
    const trivyPath = path.join(paths.resources, 'linux', 'internal', 'trivy');

    await this.lima('copy', trivyPath, `${ MACHINE_NAME }:./trivy`);
    await this.ssh('sudo', 'mv', './trivy', '/usr/local/bin/trivy');
  }

  protected async followLogs() {
    try {
      this.logProcess?.kill('SIGTERM');
    } catch (ex) { }
    let args = ['shell', '--workdir=.', MACHINE_NAME,
      '/usr/bin/tail', '-n+1', '-F', '/var/log/k3s.log'];

    args = this.debug ? ['--debug'].concat(args) : args;
    this.logProcess = childProcess.spawn(
      LimaBackend.limactl,
      args,
      {
        env:   LimaBackend.limaEnv,
        stdio: ['ignore', await Logging.k3s.fdStream, await Logging.k3s.fdStream],
      },
    );
    this.logProcess.on('exit', (status, signal) => {
      this.logProcess = null;
      if (![Action.STARTING, Action.NONE].includes(this.currentAction)) {
        // Allow the log process to exit if we're stopping
        return;
      }
      if (![K8s.State.STARTING, K8s.State.STARTED].includes(this.state)) {
        // Allow the log process to exit if we're not active.
        return;
      }
      console.log(`Log process exited with ${ status }/${ signal }, restarting...`);
      setTimeout(this.followLogs.bind(this), 1_000);
    });
  }

  protected async deleteIncompatibleData(isDowngrade: boolean) {
    if (isDowngrade) {
      this.lastCommandComment = 'Deleting incompatible Kubernetes state';
      await this.progressTracker.action(
        this.lastCommandComment,
        100,
        this.k3sHelper.deleteKubeState((...args: string[]) => this.ssh('sudo', ...args)));
    }
  }

  /**
   * Start the VM.  If the machine is already started, this does nothing.
   * Note that this does not start k3s.
   * @precondition The VM configuration is correct.
   */
  protected async startVM() {
    if (os.platform() === 'darwin') {
      this.lastCommandComment = 'Installing networking requirements';
      await this.progressTracker.action(this.lastCommandComment, 100, async() => {
        await this.installCustomLimaNetworkConfig(this.#allowSudo);
      });
    }

    // We need both the lima config + the lima network config to correctly check if we need sudo
    // access; but if it's denied, we need to regenerate both again to account for the change.
    this.lastCommandComment = 'Asking for permission to run tasks as administrator';
    const allowRoot = await this.progressTracker.action(this.lastCommandComment, 100, this.installToolsWithSudo());

    if (!allowRoot) {
      // sudo access was denied; re-generate the config.
      this.lastCommandComment = 'Regenerating configuration to account for lack of permissions';
      await this.progressTracker.action(this.lastCommandComment, 100, Promise.all([
        this.updateConfig(undefined, false),
        this.installCustomLimaNetworkConfig(false),
      ]));
    }

    this.lastCommandComment = 'Starting virtual machine';
    await this.progressTracker.action(this.lastCommandComment, 100, async() => {
      try {
        await this.lima('start', '--tty=false', await this.isRegistered ? MACHINE_NAME : this.CONFIG_PATH);
      } finally {
        // Symlink the logs (especially if start failed) so the users can find them
        const machineDir = path.join(paths.lima, MACHINE_NAME);

        // Start the process, but ignore the result.
        fs.promises.readdir(machineDir)
          .then(filenames => filenames.filter(x => x.endsWith('.log'))
            .forEach(filename => fs.promises.symlink(
              path.join(path.relative(paths.logs, machineDir), filename),
              path.join(paths.logs, `lima.${ filename }`))
              .catch(() => { })));
        try {
          await fs.promises.rm(this.CONFIG_PATH, { force: true });
        } catch (e) {
          console.debug(`Failed to delete ${ this.CONFIG_PATH }: ${ e }`);
        }
      }
    });
  }

  /**
   * Path to the 'rancher-desktop' docker context directory.  The last component
   * is the SHA256 hash of the docker context name ('rancher-desktop'), per the
   * docker convention.
   */
  protected readonly dockerContextPath = path.join(os.homedir(),
    '.docker', 'contexts', 'meta',
    'b547d66a5de60e5f0843aba28283a8875c2ad72e99ba076060ef9ec7c09917c8');

  /**
   * Update the rancher-desktop docker context to point to the alternate
   * location for the docker socket; if we are _not_ the default socket, also
   * set the default context to the updated one.
   * @param socketPath Path to the rancher-desktop specific docker socket.
   * @param kubernetesEndpoint Path to rancher-desktop Kubernetes endpoint.
   * @param defaultSocket Whether we managed to set the default socket.
   */
  protected async updateDockerContext(this: Readonly<this> & this, socketPath: string, kubernetesEndpoint?: string, defaultSocket = false): Promise<void> {
    const configPath = path.join(this.dockerContextPath, '../../../config.json');
    const contextName = 'rancher-desktop';
    const contextContents = {
      Name:      contextName,
      Metadata:  { Description: 'Rancher Desktop moby context' },
      Endpoints: {
        docker: {
          Host:          `unix://${ socketPath }`,
          SkipTLSVerify: false,
        },
      } as Record<string, {Host: string, SkipTLSVerify: boolean, DefaultNamespace?: string}>,
    };

    if (kubernetesEndpoint) {
      contextContents.Endpoints.kubernetes = {
        Host:             kubernetesEndpoint,
        SkipTLSVerify:    true,
        DefaultNamespace: 'default',
      };
    }

    console.debug(`Updating docker context: writing to ${ this.dockerContextPath }`, contextContents);

    await fs.promises.mkdir(this.dockerContextPath, { recursive: true });
    await fs.promises.writeFile(path.join(this.dockerContextPath, 'meta.json'), JSON.stringify(contextContents));

    // We now need to set up the docker contexts. In order of preference:
    // 1. If we have control of the default socket (`/var/run/docker.sock`), unset the current
    //    context and let the CLI (and other tools) use the default socket.  This should have the
    //    widest compatibility.
    // 2. Otherwise, check the current context and don't change anything if any of the following is
    //    true:
    //    - The current context uses a valid unix socket - the user is probably using it.
    //    - The current context uses a non-unix socket (e.g. tcp) - we can't check if it's valid.
    // 3. The current context is invalid - set the current context to our (rancher-desktop) context.

    try {
      const existingConfig: {currentContext?: string} =
        JSON.parse(await fs.promises.readFile(configPath, { encoding: 'utf-8' })) ?? {};

      if (defaultSocket) {
        // If we _are_ the default socket, we can just unset the current context
        // (which will cause it to use the default)
        if (existingConfig.currentContext) {
          delete existingConfig.currentContext;
          await fs.promises.writeFile(configPath, JSON.stringify(existingConfig));
        }

        return;
      }

      if (existingConfig.currentContext === contextName) {
        return;
      }

      // We don't have the default socket, and the existing config doesn't
      // exist or isn't pointing at our context.
      // We should look up the current context, and check if it's valid; if
      // (and only if) it's not valid, then set the default context to ours.
      if (existingConfig.currentContext) {
        const existingSocketUri = await this.getCurrentDockerSocket(existingConfig.currentContext);

        if (!existingSocketUri.startsWith('unix://')) {
          // Using a non-unix socket (e.g. TCP); assume it's working fine.
          return;
        }
        const existingSocket = existingSocketUri.replace(/^unix:\/\//, '');

        try {
          if ((await fs.promises.stat(existingSocket)).isSocket()) {
            return;
          }
          console.log(`Invalid existing context "${ existingConfig.currentContext }": ${ existingSocketUri } is not a socket; overriding context.`);
        } catch (ex) {
          console.log(`Could not read existing docker socket ${ existingSocketUri }, overriding context "${ existingConfig.currentContext }": ${ ex }`);
        }
      }
      existingConfig.currentContext = contextName;
      await fs.promises.writeFile(configPath, JSON.stringify(existingConfig));
    } catch (ex: any) {
      if (ex?.code !== 'ENOENT') {
        throw ex;
      }
      if (!defaultSocket) {
        // The config doesn't exist, and we are _not_ the default socket.
        // We need to write a docker config.
        const config = { currentContext: contextName };

        await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
        await fs.promises.writeFile(configPath, JSON.stringify(config));
      }
    }
  }

  /**
   * Clear the docker context; this is used for factory reset.
   */
  protected async clearDockerContext(): Promise<void> {
    const configPath = path.join(this.dockerContextPath, '../../../config.json');
    const contextName = 'rancher-desktop';

    try {
      await fs.promises.rm(this.dockerContextPath, { recursive: true, force: true });

      const existingConfig: {currentContext?: string} =
        JSON.parse(await fs.promises.readFile(configPath, { encoding: 'utf-8' })) ?? {};

      if (existingConfig?.currentContext !== contextName) {
        return;
      }
      delete existingConfig.currentContext;
      await fs.promises.writeFile(configPath, JSON.stringify(existingConfig));
    } catch (ex) {
      // Ignore the error; there really isn't much we can usefully do here.
      console.debug(`Ignoring error when clearing docker context: ${ ex }`);
    }
  }

  /**
   * Read the docker configuration, and return the docker socket in use by the
   * current context.  If the context is invalid, return the default socket
   * location.
   *
   * @param currentContext docker's current context, as set in the configs.
   */
  protected async getCurrentDockerSocket(currentContext: string): Promise<string> {
    const defaultSocket = `unix://${ DEFAULT_DOCKER_SOCK_LOCATION }`;
    const contextParent = path.dirname(this.dockerContextPath);

    for (const dir of await fs.promises.readdir(contextParent)) {
      const dirPath = path.join(contextParent, dir, 'meta.json');

      try {
        const data = yaml.parse(await fs.promises.readFile(dirPath, 'utf-8'));

        if (data.Name === currentContext) {
          return data.Endpoints?.docker?.Host as string ?? defaultSocket;
        }
      } catch (ex) {
        console.log(`Failed to read context ${ dir }, skipping: ${ ex }`);
      }
    }

    // If we reach here, the current context is invalid.
    return defaultSocket;
  }

  async start(config: Settings['kubernetes']): Promise<void> {
    this.cfg = config;
    const desiredVersion = await this.desiredVersion;
    const previousVersion = (await this.currentConfig)?.k3s?.version;
    const isDowngrade = previousVersion ? semver.gt(previousVersion, desiredVersion) : false;
    let commandArgs: Array<string>;
    const enabledK3s = this.#enabledK3s = config.enabled;

    this.#desiredPort = config.port;
    this.setState(K8s.State.STARTING);
    this.currentAction = Action.STARTING;
    if (this.cfg?.containerEngine) {
      this.#currentContainerEngine = this.cfg.containerEngine;
    }
    this.lastCommandComment = 'Starting Backend';
    await this.progressTracker.action(this.lastCommandComment, 10, async() => {
      try {
        await this.ensureArchitectureMatch();
        if (enabledK3s) {
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

            this.progressTracker.numeric('Downloading Kubernetes components', sum('current'), sum('max'));
          }, 250);
        }

        this.lastCommandComment = 'Ensure virtualization is supported; check cluster configuration';
        await Promise.all([
          this.progressTracker.action('Ensuring virtualization is supported', 50, this.ensureVirtualizationSupported()),
          this.progressTracker.action('Updating cluster configuration', 50, this.updateConfig(desiredVersion)),
        ]);
        if (enabledK3s) {
          this.lastCommandComment = 'Checking k3s images';
          await this.progressTracker.action(this.lastCommandComment, 100, this.k3sHelper.ensureK3sImages(desiredVersion));
        }

        if (this.currentAction !== Action.STARTING) {
          // User aborted before we finished
          return;
        }

        // We have no good estimate for the rest of the steps, go indeterminate.
        timers.clearInterval(this.progressInterval as ReturnType<typeof timers.setInterval>);
        this.progressInterval = undefined;

        if ((await this.status)?.status === 'Running') {
          this.lastCommandComment = 'Stopping existing instance';
          await this.progressTracker.action(this.lastCommandComment, 100, async() => {
            await this.ssh('sudo', '/sbin/rc-service', '--ifstarted', 'k3s', 'stop');
            if (isDowngrade) {
              // If we're downgrading, stop the VM (and start it again immediately),
              // to ensure there are no containers running (so we can delete files).
              await this.lima('stop', MACHINE_NAME);
            }
          });
        }

        // Start the VM; if it's already running, this does nothing.
        await this.startVM();

        await this.deleteIncompatibleData(isDowngrade);
        await this.progressTracker.action(this.lastCommandComment, 50, this.configureContainerd());
        if (this.#currentContainerEngine === ContainerEngine.CONTAINERD) {
          await this.startService('containerd');
        } else if (this.#currentContainerEngine === ContainerEngine.MOBY) {
          await this.startService('docker');
        }
        // Always install the k3s config files
        this.lastCommandComment = 'Installing k3s';
        await this.progressTracker.action(this.lastCommandComment, 50, async() => {
          await this.installK3s(desiredVersion);
          await this.writeServiceScript();
        });

        this.lastCommandComment = 'Installing Buildkit';
        await this.progressTracker.action(this.lastCommandComment, 50, this.writeBuildkitScripts());
        this.lastCommandComment = 'Installing trivy & CA certs';
        await Promise.all([
          this.progressTracker.action('Installing image scanner', 50, this.installTrivy()),
          this.progressTracker.action('Installing CA certificates', 50, this.installCACerts()),
        ]);
        await this.progressTracker.action('Installing credential helper', 50, this.installCredentialHelper());

        if (this.currentAction !== Action.STARTING) {
          // User aborted
          return;
        }

        /** k3sEndpoint is the Kubernetes endpoint we want to use for the docker config. */
        let k3sEndpoint: string | undefined;

        if (enabledK3s) {
          // Remove flannel config if necessary, before starting k3s
          if (!this.cfg?.options.flannel) {
            await this.ssh('sudo', 'rm', '-f', '/etc/cni/net.d/10-flannel.conflist');
          }

          this.lastCommandComment = 'Starting k3s';
          await this.progressTracker.action(this.lastCommandComment, 100, async() => {
            // Run rc-update as we have dynamic dependencies.
            await this.ssh('sudo', '/sbin/rc-update', '--update');
            await this.ssh('sudo', '/sbin/rc-service', '--ifnotstarted', 'k3s', 'start');
            await this.followLogs();
          });

          this.lastCommandComment = 'Waiting for Kubernetes API';
          await this.progressTracker.action(
            this.lastCommandComment,
            100,
            async() => {
              await this.k3sHelper.waitForServerReady(() => Promise.resolve('127.0.0.1'), this.#desiredPort);
              while (true) {
                if (this.currentAction !== Action.STARTING) {
                  // User aborted
                  return;
                }
                try {
                  let args = ['shell', '--workdir=.', MACHINE_NAME,
                    'ls', '/etc/rancher/k3s/k3s.yaml'];

                  args = this.debug ? ['--debug'].concat(args) : args;
                  await childProcess.spawnFile(LimaBackend.limactl, args,
                    { env: LimaBackend.limaEnv, stdio: 'ignore' });
                  break;
                } catch (ex) {
                  console.log('Configuration /etc/rancher/k3s/k3s.yaml not present in lima vm; will check again...');
                  await util.promisify(setTimeout)(1_000);
                }
              }
              console.debug('/etc/rancher/k3s/k3s.yaml is ready.');
            }
          );
          commandArgs = ['shell', '--workdir=.', MACHINE_NAME, 'sudo', 'cat', '/etc/rancher/k3s/k3s.yaml'];
          this.lastCommandComment = 'Updating kubeconfig';
          await this.progressTracker.action(
            this.lastCommandComment,
            50,
            this.k3sHelper.updateKubeconfig(
              async() => {
                const k3sConfigString = await this.limaWithCapture(...commandArgs);
                const k3sConfig = yaml.parse(k3sConfigString);

                k3sEndpoint = k3sConfig?.clusters?.[0]?.cluster?.server;

                return k3sConfigString;
              }));

          this.client = new K8s.Client();

          this.lastCommandComment = 'Waiting for services';
          await this.progressTracker.action(
            this.lastCommandComment,
            50,
            async() => {
              const client = this.client as KubeClient;

              await client.waitForServiceWatcher();
              client.on('service-changed', (services) => {
                this.emit('service-changed', services);
              });
            }
          );

          this.activeVersion = desiredVersion;
          this.currentPort = this.#desiredPort;
          this.emit('current-port-changed', this.currentPort);

          // Remove traefik if necessary.
          if (!this.cfg?.options.traefik) {
            await this.progressTracker.action(
              'Removing Traefik',
              50,
              this.k3sHelper.uninstallTraefik(this.client));
          }

          // Trigger kuberlr to ensure there's a compatible version of kubectl in place for the users
          // rancher-desktop mostly uses the K8s API instead of kubectl, so we need to invoke kubectl
          // to nudge kuberlr

          commandArgs = ['--context', 'rancher-desktop', 'cluster-info'];
          try {
            await childProcess.spawnFile(resources.executable('kubectl'),
              commandArgs,
              { stdio: Logging.k8s });
          } catch (ex) {
            console.error('Error priming kuberlr');
            throw ex;
          }

          if (this.cfg?.options.flannel) {
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
        }

        // We can't install buildkitd earlier because if we were running an older version of rancher-desktop,
        // we have to remove the kim buildkitd k8s artifacts. And we can't remove them until k8s is running.
        // Note that if the user's workflow is:
        // A. Only containerd
        // settings version 3: containerd (which installs buildkitd)
        // upgrade to settings version 4, still on containerd:
        //   - remove the old kim/buildkitd artifacts
        //   - set config.kubernetes.checkForExistingKimBuilder to false (forever)

        // B. Mix of containerd and moby
        // settings version 3: containerd (which installs buildkitd)
        // settings version 3: switch to moby (which will uninstall buildkitd)
        // upgrade to settings version 4, still on moby: do nothing here
        // settings version 4, switch to containerd
        //   - config.kubernetes.checkForExistingKimBuilder should be true, but there are no kim/buildkitd artifacts
        //   - do nothing, and set config.kubernetes.checkForExistingKimBuilder to false (forever)

        if (config.checkForExistingKimBuilder && enabledK3s) {
          this.client ??= new K8s.Client();
          await getImageProcessor(this.#currentContainerEngine, this).removeKimBuilder(this.client.k8sClient);
          // No need to remove kim builder components ever again.
          config.checkForExistingKimBuilder = false;
          this.emit('kim-builder-uninstalled');
        }
        if (this.#currentContainerEngine === ContainerEngine.MOBY) {
          await this.updateDockerContext(
            path.join(paths.altAppHome, 'docker.sock'),
            k3sEndpoint,
            this.#allowSudo);
        }
        if (this.#currentContainerEngine === ContainerEngine.CONTAINERD) {
          await this.ssh('sudo', '/sbin/rc-service', '--ifnotstarted', 'buildkitd', 'start');
        }

        this.setState(enabledK3s ? K8s.State.STARTED : K8s.State.DISABLED);
      } catch (err) {
        console.error('Error starting lima:', err);
        this.setState(K8s.State.ERROR);
        throw err;
      } finally {
        this.currentAction = Action.NONE;
      }
    });
  }

  protected async startService(serviceName: string) {
    this.lastCommandComment = `Starting ${ serviceName }`;
    await this.progressTracker.action(this.lastCommandComment, 50, async() => {
      await this.ssh('sudo', '/sbin/rc-service', '--ifnotstarted', serviceName, 'start');
    });
  }

  protected async installCACerts(): Promise<void> {
    const certs: (string | Buffer)[] = await new Promise((resolve) => {
      mainEvents.once('cert-ca-certificates', resolve);
      mainEvents.emit('cert-get-ca-certificates');
    });

    const workdir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rd-ca-'));

    try {
      await this.ssh('sudo', '/bin/sh', '-c', 'rm -f /usr/local/share/ca-certificates/rd-*.crt');

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

        await this.lima('copy', path.join(workdir, 'certs.tar'), `${ MACHINE_NAME }:/tmp/certs.tar`);
        await this.ssh('sudo', 'tar', 'xf', '/tmp/certs.tar', '-C', '/usr/local/share/ca-certificates/');
      }
    } finally {
      await fs.promises.rm(workdir, { recursive: true, force: true });
    }
    await this.ssh('sudo', 'update-ca-certificates');
  }

  protected async getHostIPAddr(): Promise<string> {
    try {
      const lines = (await this.limaWithCapture('shell', '--workdir=.', MACHINE_NAME, 'ip', 'route', 'list', 'eth0')).split(/\n/);
      const fields = lines[0].split(/\s+/);

      return fields[2];
    } catch (err: any) {
      console.log(`ip route failed: ${ err }`, err);
      throw err;
    }
  }

  protected async installCredentialHelper() {
    const credsPath = getServerCredentialsPath();

    try {
      const hostIPAddr = await this.getHostIPAddr();
      const stateInfo: ServerState = JSON.parse(await fs.promises.readFile(credsPath, { encoding: 'utf-8' }));
      const escapedPassword = stateInfo.password.replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n');
      const fileContents = `CREDFWD_AUTH="${ stateInfo.user }:${ escapedPassword }"
CREDFWD_URL="http://${ hostIPAddr }:${ stateInfo.port }"
`;
      const credfwdDir = '/etc/rancher/desktop';
      const credfwdFile = `${ credfwdDir }/credfwd`;

      await this.ssh('sudo', 'mkdir', '-p', credfwdDir);
      await this.writeFile(credfwdFile, fileContents, 0o644);
      await this.writeFile('/usr/local/bin/docker-credential-rancher-desktop', DOCKER_CREDENTIAL_SCRIPT, 0o755);
    } catch (err: any) {
      console.log(`Error trying to create the credfwd file: ${ err }`);
    }
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

    this.lastCommandComment = 'Stopping services';
    await this.progressTracker.action(this.lastCommandComment, 10, async() => {
      try {
        this.setState(K8s.State.STOPPING);

        const status = await this.status;

        if (defined(status) && status.status === 'Running') {
          await this.ssh('sudo', '/sbin/rc-service', '--ifstarted', 'k3s', 'stop');
          await this.ssh('sudo', '/sbin/rc-service', '--ifstarted', 'buildkitd', 'stop');
          await this.ssh('sudo', '/sbin/rc-service', '--ifstarted', 'docker', 'stop');
          await this.ssh('sudo', '/sbin/rc-service', '--ifstarted', 'containerd', 'stop');
          await this.lima('stop', MACHINE_NAME);
        }
        this.setState(K8s.State.STOPPED);
      } catch (ex) {
        this.setState(K8s.State.ERROR);
        throw ex;
      } finally {
        this.currentAction = Action.NONE;
      }
    });
  }

  async del(force = false): Promise<void> {
    try {
      const delArgs = ['delete'];

      force ? delArgs.push('--force', MACHINE_NAME) : delArgs.push(MACHINE_NAME);
      if (await this.isRegistered) {
        await this.stop();
        this.lastCommandComment = 'Deleting Kubernetes VM';
        await this.progressTracker.action(
          this.lastCommandComment,
          10,
          this.lima(...delArgs));
      }
    } catch (ex) {
      this.setState(K8s.State.ERROR);
      throw ex;
    }

    this.cfg = undefined;
  }

  async reset(config: Settings['kubernetes']): Promise<void> {
    this.lastCommandComment = 'Resetting Kubernetes';
    await this.progressTracker.action(this.lastCommandComment, 5, async() => {
      await this.stop();
      // Start the VM, so that we can delete files.
      await this.startVM();
      await this.k3sHelper.deleteKubeState(
        (...args: string[]) => this.ssh('sudo', ...args));
      await this.start(config);
    });
  }

  async factoryReset(): Promise<void> {
    const promises: Array<Promise<void>> = [];
    const pathsToDelete = new Set([
      paths.cache,
      paths.appHome,
      paths.altAppHome,
      paths.config,
      paths.logs,
    ]);

    if (!Array.from(pathsToDelete).some(dir => paths.lima.startsWith(dir))) {
      // Add lima if it isn't in any of the subtrees slated for deletion.
      pathsToDelete.add(paths.lima);
    }
    await this.del(true);

    for (const path of pathsToDelete) {
      promises.push(fs.promises.rm(path, { recursive: true, force: true }));
    }
    promises.push(this.clearDockerContext());
    await Promise.all(promises);
  }

  async requiresRestartReasons(): Promise<Record<string, [any, any] | []>> {
    if (this.currentAction !== Action.NONE || this.internalState === K8s.State.ERROR || !this.#enabledK3s) {
      // If we're in the middle of starting or stopping, or not using k3s, we don't need to restart.
      return {};
    }

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
    cmp('port', this.currentPort, this.cfg.port);

    return results;
  }

  listServices(namespace?: string): K8s.ServiceEntry[] {
    return this.client?.listServices(namespace) || [];
  }

  async isServiceReady(namespace: string, service: string): Promise<boolean> {
    return (await this.client?.isServiceReady(namespace, service)) || false;
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

  async getFailureDetails(exception: any): Promise<K8s.FailureDetails> {
    const logfile = console.path;
    const logLines = (await fs.promises.readFile(logfile, 'utf-8')).split('\n').slice(-10);
    const details: K8s.FailureDetails = {
      lastCommand:        exception[childProcess.ErrorCommand],
      lastCommandComment: this.lastCommandComment,
      lastLogLines:       logLines,
    };

    return details;
  }
}
