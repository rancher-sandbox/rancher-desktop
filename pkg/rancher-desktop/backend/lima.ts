// Kubernetes backend for macOS, based on Lima.

import { ChildProcess, spawn as spawnWithSignal } from 'child_process';
import crypto from 'crypto';
import events from 'events';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import stream from 'stream';
import util from 'util';

import Electron from 'electron';
import merge from 'lodash/merge';
import zip from 'lodash/zip';
import semver from 'semver';
import sudo from 'sudo-prompt';
import tar from 'tar-stream';
import yaml from 'yaml';

import {
  Architecture, BackendError, BackendEvents, BackendProgress, BackendSettings, execOptions, FailureDetails, RestartReasons, State, VMBackend, VMExecutor,
} from './backend';
import BackendHelper from './backendHelper';
import K3sHelper from './k3sHelper';
import * as K8s from './k8s';
import ProgressTracker, { getProgressErrorDescription } from './progressTracker';

import DEPENDENCY_VERSIONS from '@pkg/assets/dependencies.yaml';
import DEFAULT_CONFIG from '@pkg/assets/lima-config.yaml';
import NETWORKS_CONFIG from '@pkg/assets/networks-config.yaml';
import FLANNEL_CONFLIST from '@pkg/assets/scripts/10-flannel.conflist';
import SERVICE_BUILDKITD_CONF from '@pkg/assets/scripts/buildkit.confd';
import SERVICE_BUILDKITD_INIT from '@pkg/assets/scripts/buildkit.initd';
import DOCKER_CREDENTIAL_SCRIPT from '@pkg/assets/scripts/docker-credential-rancher-desktop';
import CONTAINERD_CONFIG from '@pkg/assets/scripts/k3s-containerd-config.toml';
import LOGROTATE_OPENRESTY_SCRIPT from '@pkg/assets/scripts/logrotate-openresty';
import NERDCTL from '@pkg/assets/scripts/nerdctl';
import NGINX_CONF from '@pkg/assets/scripts/nginx.conf';
import SERVICE_GUEST_AGENT_INIT from '@pkg/assets/scripts/rancher-desktop-guestagent.initd';
import { ContainerEngine, defaultSettings } from '@pkg/config/settings';
import { getServerCredentialsPath, ServerState } from '@pkg/main/credentialServer/httpCredentialHelperServer';
import mainEvents from '@pkg/main/mainEvents';
import * as childProcess from '@pkg/utils/childProcess';
import clone from '@pkg/utils/clone';
import DockerDirManager from '@pkg/utils/dockerDirManager';
import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';
import { jsonStringifyWithWhiteSpace } from '@pkg/utils/stringify';
import { defined, RecursivePartial } from '@pkg/utils/typeUtils';
import { openSudoPrompt } from '@pkg/window';

/**
 * Enumeration for tracking what operation the backend is undergoing.
 */
export enum Action {
  NONE = 'idle',
  STARTING = 'starting',
  STOPPING = 'stopping',
}

/**
 * Enumeration for determining whether to use vde_vmnet or socket_vmnet.
 */
enum VMNet {
  VDE,
  SOCKET,
}

/**
 * Lima configuration
 */
export type LimaConfiguration = {
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
};

/**
 * Lima networking configuration.
 * @see https://github.com/lima-vm/lima/blob/v0.8.0/pkg/networks/networks.go
 */
interface LimaNetworkConfiguration {
  paths: {
    socketVMNet?: string;
    vdeSwitch?: string;
    vdeVMNet?: string;
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

export const MACHINE_NAME = '0';
const IMAGE_VERSION = DEPENDENCY_VERSIONS.alpineLimaISO.isoVersion;
const ALPINE_EDITION = 'rd';
const ALPINE_VERSION = DEPENDENCY_VERSIONS.alpineLimaISO.alpineVersion;

const ETC_RANCHER_DESKTOP_DIR = '/etc/rancher/desktop';
const CREDENTIAL_FORWARDER_SETTINGS_PATH = path.join(ETC_RANCHER_DESKTOP_DIR, 'credfwd');
const DOCKER_CREDENTIAL_PATH = '/usr/local/bin/docker-credential-rancher-desktop';
const ROOT_DOCKER_CONFIG_DIR = '/root/.docker';
const ROOT_DOCKER_CONFIG_PATH = path.join(ROOT_DOCKER_CONFIG_DIR, 'config.json');

/** The following files, and their parents up to /, must only be writable by root,
 *  and none of them are allowed to be symlinks (lima-vm requirements).
 */
const VMNET_DIR = '/opt/rancher-desktop';

// Make this file the last one to be loaded by `sudoers` so others don't override needed settings.
// Details at https://github.com/rancher-sandbox/rancher-desktop/issues/1444
// This path introduced in version 1.0.1
const LIMA_SUDOERS_LOCATION = '/private/etc/sudoers.d/zzzzz-rancher-desktop-lima';
// Filename used in versions 1.0.0 and earlier:
const PREVIOUS_LIMA_SUDOERS_LOCATION = '/private/etc/sudoers.d/rancher-desktop-lima';

/** Forward compatible limactl binary allows for support of lima built for newer
 * versions of Darwin/macOS.
 *
 * When the xcode version used to build the forward compatible limactl binary
 * changes, update fwdCompatLimactlDarwinVer with the Darwin version
 * that xcode version is usually installed on.
 *
 * Xcode version used to build forward compatible limactl can be found here:
 * https://github.com/rancher-sandbox/lima-and-qemu/blob/main/.github/workflows/release.yml#L105
 *
 * Find which macOS the xcode version is installed on by default in the Xcode table:
 * https://en.wikipedia.org/wiki/Xcode#Xcode_11.0_-_14.x_(since_SwiftUI_framework)
 *
 * Then match the macOS version to the Darwin version.
 *
 * For Ventura see the Release History table:
 * https://en.wikipedia.org/wiki/MacOS_Ventura#Release_history
 */
// Name of the forward compatible limactl binary installed by the lima dependencies script.
const fwdCompatLimactlBin = 'limactl.ventura';
// Version of Darwin the forward compatible limactl binary was built for.
const fwdCompatLimactlDarwinVer = '22.2.0';

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
export default class LimaBackend extends events.EventEmitter implements VMBackend, VMExecutor {
  constructor(arch: Architecture, dockerDirManager: DockerDirManager, kubeFactory: (backend: LimaBackend) => K8s.KubernetesBackend) {
    super();
    this.arch = arch;
    this.dockerDirManager = dockerDirManager;
    this.kubeBackend = kubeFactory(this);

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

  readonly kubeBackend: K8s.KubernetesBackend;
  readonly executor = this;

  protected readonly CONFIG_PATH = path.join(paths.lima, '_config', `${ MACHINE_NAME }.yaml`);

  /**
   * Initialize this field to `defaultSettings` instead of `undefined` to avoid `?.` sequences everywhere we use it.
   */
  protected cfg: BackendSettings = defaultSettings;

  /** The current architecture. */
  protected readonly arch: Architecture;

  /** Used to manage the docker CLI config directory. */
  protected readonly dockerDirManager: DockerDirManager;

  /** The version of Kubernetes currently running. */
  protected activeVersion: semver.SemVer | null = null;

  /** Whether we can prompt the user for administrative access - this setting persists in the config. */
  #adminAccess = true;

  /** A transient property that prevents prompting via modal UI elements. */
  #noModalDialogs = false;

  get noModalDialogs() {
    return this.#noModalDialogs;
  }

  set noModalDialogs(value: boolean) {
    this.#noModalDialogs = value;
  }

  /** Helper object to manage progress notifications. */
  progressTracker;

  /**
   * The current operation underway; used to avoid responding to state changes
   * when we're in the process of doing a different one.
   */
  currentAction: Action = Action.NONE;

  writeSetting(changed: RecursivePartial<BackendSettings>) {
    if (changed) {
      mainEvents.emit('settings-write', changed);
    }
    this.cfg = merge({}, this.cfg, changed);
  }

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
      await this.kubeBackend.cleanup();
    }
  }

  progress: BackendProgress = { current: 0, max: 0 };

  debug = false;

  emit: VMBackend['emit'] = this.emit;

  get backend(): 'lima' {
    return 'lima';
  }

  get cpus(): Promise<number> {
    return (async() => {
      return (await this.getLimaConfig())?.cpus || 0;
    })();
  }

  get memory(): Promise<number> {
    return (async() => {
      return Math.round(((await this.getLimaConfig())?.memory || 0) / 1024 / 1024 / 1024);
    })();
  }

  protected async ensureArchitectureMatch() {
    if (os.platform().startsWith('darwin')) {
      // Normally, `file` command returns "... executable arm64" or "... executable x86_64"
      // But if there are problems reading the file, `file' follows the POSIX spec, writes its
      // error message to stdout, and returns exit code 0 (overridable with a `-E` flag on newer
      // versions of macos). Best to do our own check before invoking `file':
      try {
        await fs.promises.access(LimaBackend.limactl, fs.constants.X_OK);
      } catch (err: any) {
        switch (err.code) {
        case 'ENOENT':
          throw new BackendError('Fatal Error', `File ${ LimaBackend.limactl } doesn't exist.`, true);
        case 'EACCES':
          throw new BackendError('Fatal Error', `File ${ LimaBackend.limactl } isn't readable.`, true);
        default:
          throw new BackendError('Fatal Error', `Error trying to analyze file ${ LimaBackend.limactl }: ${ err }`, true);
        }
      }
      const expectedArch = this.arch === 'aarch64' ? 'arm64' : this.arch;
      const { stdout } = await childProcess.spawnFile(
        'file', [LimaBackend.limactl],
        { stdio: ['inherit', 'pipe', console] });

      if (!stdout.includes(`executable ${ expectedArch }`)) {
        /* Using 'aarch64' and 'x86_64' in the error because that's what we use for the DMG suffix, e.g. "Rancher Desktop.aarch64.dmg" */
        const otherArch = { aarch64: 'x86_64', x86_64: 'aarch64' }[this.arch];

        throw new BackendError('Fatal Error', `Rancher Desktop for ${ otherArch } does not work on ${ this.arch }.`, true);
      }
    }
  }

  protected async ensureVirtualizationSupported() {
    if (os.platform().startsWith('linux')) {
      const cpuInfo = await fs.promises.readFile('/proc/cpuinfo', 'utf-8');

      if (!/flags.*(vmx|svm)/g.test(cpuInfo)) {
        console.log(`Virtualization support error: got ${ cpuInfo }`);
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

  /**
   * Get the IPv4 address of the VM, assuming it's already up.
   * In Lima the slirp IP is hard-coded to 192.168.5.15.
   */
  get ipAddress(): Promise<string | undefined> {
    return Promise.resolve('192.168.5.15');
  }

  getBackendInvalidReason(): Promise<BackendError | null> {
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
    // Image version may have a '+rd1' (or '.rd1') suffix after the upstream semver version.
    const versionMatch = images.map(i => /^alpl?ine-lima-v([0-9.]+)(?:[+.]rd(\d+))?-/.exec(i)).find(defined);
    const existingVersion = semver.coerce(versionMatch?.[1]);
    const existingRDVersion = versionMatch?.[2];

    if (!existingVersion) {
      console.log(`Could not find base image version from ${ images }; skipping update of base images.`);

      return;
    }

    let versionComparison = semver.coerce(IMAGE_VERSION)?.compare(existingVersion);

    // Compare RD patch versions if upstream semver are matching
    if (versionComparison === 0) {
      const rdVersionMatch = IMAGE_VERSION.match(/[+.]rd(\d+)/);

      if (rdVersionMatch) {
        if (existingRDVersion) {
          if (parseInt(existingRDVersion) < parseInt(rdVersionMatch[1])) {
            versionComparison = 1;
          }
        } else {
          // If the new image has an RD patch version, but the old one doesn't, then the new version is newer.
          versionComparison = 1;
        }
      } else if (existingRDVersion) {
        // If the old image has an RD patch version, but the new one doesn't, then the new version is older.
        versionComparison = -1;
      }
    }

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
      throw new BackendError('Rancher Desktop Update Required', message.replace(/\s+/g, ' ').trim());
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

      throw new BackendError('Fatal Error', message.replace(/\s+/g, ' ').trim());
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
          const existingPort = (await this.getLimaConfig())?.ssh.localPort;

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
  protected async updateConfig(allowRoot = true) {
    const currentConfig = await this.getLimaConfig();
    const baseConfig: Partial<LimaConfiguration> = currentConfig || {};
    // We use {} as the first argument because merge() modifies
    // it, and it would be less safe to modify baseConfig.
    const config: LimaConfiguration = merge({}, baseConfig, DEFAULT_CONFIG as LimaConfiguration, {
      images: [{
        location: this.baseDiskImage,
        arch:     this.arch,
      }],
      cpus:   this.cfg.virtualMachine.numberCPUs || 4,
      memory: (this.cfg.virtualMachine.memoryInGB || 4) * 1024 * 1024 * 1024,
      mounts: [
        { location: path.join(paths.cache, 'k3s'), writable: false },
        { location: paths.logs, writable: true },
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
        },
      },
    });

    // Alpine can boot via UEFI now
    if (config.firmware) {
      config.firmware.legacyBIOS = false;
    }

    // RD used to store additional keys in lima.yaml that are not supported by lima (and no longer used by RD).
    // They must be removed because lima intends to switch to strict YAML parsing, so typos can be detected.
    delete (config as Record<string, unknown>).k3s;
    delete (config as Record<string, unknown>).paths;

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
        console.log('Administrator access disallowed, not using vde/socket_vmnet.');
        delete config.networks;
      }
    }

    this.updateConfigPortForwards(config);
    if (currentConfig) {
      // update existing configuration
      const configPath = path.join(paths.lima, MACHINE_NAME, 'lima.yaml');

      await this.progressTracker.action(
        'Updating outdated virtual machine',
        100,
        this.updateBaseDisk(currentConfig),
      );
      await fs.promises.writeFile(configPath, yaml.stringify(config, { lineWidth: 0 }), 'utf-8');
    } else {
      // new configuration
      await fs.promises.mkdir(path.dirname(this.CONFIG_PATH), { recursive: true });
      await fs.promises.writeFile(this.CONFIG_PATH, yaml.stringify(config, { lineWidth: 0 }));
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

  protected getLimaConfig(): Promise<LimaConfiguration | undefined> {
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
    let limactlBin = 'limactl';

    if (os.platform() === 'darwin' && semver.gte(os.release(), fwdCompatLimactlDarwinVer)) {
      limactlBin = fwdCompatLimactlBin;
    }

    return path.join(paths.resources, os.platform(), 'lima', 'bin', limactlBin);
  }

  protected static get limaEnv() {
    const binDir = path.join(paths.resources, os.platform(), 'lima', 'bin');
    const VMNETDir = path.join(VMNET_DIR, 'bin');
    const pathList = (process.env.PATH || '').split(path.delimiter);
    const newPath = [binDir, VMNETDir].concat(...pathList).filter(x => x);

    return {
      ...process.env, LIMA_HOME: paths.lima, PATH: newPath.join(path.delimiter),
    };
  }

  /**
   * Run `limactl` with the given arguments.
   */
  async lima(this: Readonly<this>, ...args: string[]): Promise<void> {
    args = this.debug ? ['--debug'].concat(args) : args;
    try {
      const { stdout, stderr } = await childProcess.spawnFile(LimaBackend.limactl, args,
        { env: LimaBackend.limaEnv, stdio: ['ignore', 'pipe', 'pipe'] });
      const formatBreak = stderr || stdout ? '\n' : '';

      console.log(`> limactl ${ args.join(' ') }${ formatBreak }${ stderr }${ stdout }`);
    } catch (ex) {
      console.error(`> limactl ${ args.join(' ') }\n$`, ex);
      throw ex;
    }
  }

  /**
   * Run `limactl` with the given arguments, and return stdout.
   */
  protected async limaWithCapture(this: Readonly<this>, ...args: string[]): Promise<string>;
  protected async limaWithCapture(this: Readonly<this>, expectFailure: true, ...args: string[]): Promise<string>;
  protected async limaWithCapture(this: Readonly<this>, argOrExpectFailure: true | string, ...args: string[]): Promise<string> {
    let expectFailure = false;

    if (typeof argOrExpectFailure === 'boolean') {
      expectFailure = true;
    } else {
      args = [argOrExpectFailure].concat(args);
      expectFailure = false;
    }
    args = this.debug ? ['--debug'].concat(args) : args;
    try {
      const { stdout, stderr } = await childProcess.spawnFile(LimaBackend.limactl, args,
        { env: LimaBackend.limaEnv, stdio: ['ignore', 'pipe', 'pipe'] });
      const formatBreak = stderr || stdout ? '\n' : '';

      console.log(`> limactl ${ args.join(' ') }${ formatBreak }${ stderr }${ stdout }`);

      return stdout;
    } catch (ex) {
      if (!expectFailure) {
        console.error(`> limactl ${ args.join(' ') }\n$`, ex);
      }
      throw ex;
    }
  }

  /**
   * Run the given command within the VM.
   */
  limaSpawn(options: execOptions, args: string[]): ChildProcess {
    args = ['shell', '--workdir=.', MACHINE_NAME].concat(args);
    args = this.debug ? ['--debug'].concat(args) : args;

    return spawnWithSignal(
      LimaBackend.limactl,
      args,
      { ...options, env: { ...LimaBackend.limaEnv, ...options.env ?? {} } });
  }

  async execCommand(...command: string[]): Promise<void>;
  async execCommand(options: execOptions, ...command: string[]): Promise<void>;
  async execCommand(options: execOptions & { capture: true }, ...command: string[]): Promise<string>;
  async execCommand(optionsOrArg: execOptions | string, ...command: string[]): Promise<void | string> {
    let options: execOptions & { capture?: boolean } = {};

    if (typeof optionsOrArg === 'string') {
      command = [optionsOrArg].concat(command);
    } else {
      options = optionsOrArg;
    }
    if (options.root) {
      command = ['sudo'].concat(command);
    }

    const expectFailure = options.expectFailure ?? false;

    try {
      // Print a slightly different message if execution fails.
      const stdout = await this.limaWithCapture(true, 'shell', '--workdir=.', MACHINE_NAME, ...command);

      if (options.capture) {
        return stdout;
      }
    } catch (ex) {
      if (!expectFailure) {
        console.log(`Lima: executing: ${ command.join(' ') }: ${ ex }`);
      }
      throw ex;
    }
  }

  spawn(...command: string[]): childProcess.ChildProcess;
  spawn(options: execOptions, ...command: string[]): childProcess.ChildProcess;
  spawn(optionsOrCommand: string | execOptions, ...command: string[]): ChildProcess {
    let options: execOptions = {};
    const args = command.concat();

    if (typeof optionsOrCommand === 'string') {
      args.unshift(optionsOrCommand);
    } else {
      options = optionsOrCommand;
    }

    return this.limaSpawn(options, args);
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
    if (this.noModalDialogs || !this.cfg.application.adminAccess) {
      return false;
    }
    const neverAgain = await openSudoPrompt(explanations);

    if (neverAgain && this.cfg) {
      this.writeSetting({ application: { adminAccess: false } });

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
  protected async installToolsWithSudo(vmnet: VMNet): Promise<boolean> {
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
      await this.progressTracker.action('Setting up virtual ethernet', 10, async() => {
        processCommand(await this.installVMNETTools(vmnet));
      });
      await this.progressTracker.action('Setting Lima permissions', 10, async() => {
        processCommand(await this.ensureRunLimaLocation());
        processCommand(await this.createLimaSudoersFile(vmnet, randomTag));
      });
    }
    await this.progressTracker.action('Setting up Docker socket', 10, async() => {
      processCommand(await this.configureDockerSocket());
    });

    if (commands.length === 0) {
      return true;
    }

    const allowed = await this.progressTracker.action(
      'Expecting user permission to continue',
      10,
      this.showSudoReason(explanations));

    if (!allowed) {
      this.#adminAccess = false;

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
        this.#adminAccess = false;
        console.error('Failed to execute sudo, falling back to unprivileged operation', err);

        return false;
      }
      throw err;
    }

    return true;
  }

  /**
   * Determine the commands required to install vmnet-related tools.
   */
  protected async installVMNETTools(this: unknown, vmnet: VMNet): Promise<SudoCommand | undefined> {
    const toolsDir = vmnet === VMNet.SOCKET ? 'socket_vmnet' : 'vde';
    const sourcePath = path.join(paths.resources, os.platform(), 'lima', toolsDir);
    const installedPath = VMNET_DIR;
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
        hashFile(sourceFile), hashFile(installedFile),
      ]);

      return sourceHash === installedHash;
    }));

    if (hashesMatch.every(matched => matched)) {
      return;
    }

    const workdir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rd-vmnet-install'));
    const tarPath = path.join(workdir, 'vmnet.tar');
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
        name: path.basename(installedPath),
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

      console.log(`VMNET tools install required: ${ command }`);
      commands.push(command);
    } finally {
      commands.push(`rm -fr ${ workdir }`);
    }

    return {
      reason: 'networking',
      commands,
      paths:  [VMNET_DIR],
    };
  }

  protected async createLimaSudoersFile(this: Readonly<this> & this, vmnet: VMNet, randomTag: string): Promise<SudoCommand | undefined> {
    const paths: string[] = [];
    const commands: string[] = [];

    try {
      await fs.promises.access(PREVIOUS_LIMA_SUDOERS_LOCATION);
      commands.push(`rm -f ${ PREVIOUS_LIMA_SUDOERS_LOCATION }`);
      paths.push(PREVIOUS_LIMA_SUDOERS_LOCATION);
      console.debug(`Previous sudoers file ${ PREVIOUS_LIMA_SUDOERS_LOCATION } exists, will delete.`);
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        console.error(`Error checking ${ PREVIOUS_LIMA_SUDOERS_LOCATION }: ${ err }; ignoring.`);
      }
    }

    // We want to generate the file via `limactl sudoers`. However, there are
    // some limitations:
    // - The vmnet executables may not be installed yet (because we try to make
    //   sure the user is only prompted for credentials once).
    // - `limactl sudoers --check` complains in situations that would be fine:
    //   - The executable names wouldn't match the installed one.
    //   - The application directory ("Rancher Desktop.app") contains spaces.
    // As a workaround, we instead:
    // 1. Run `limactl sudoers` to generate the desired output, but using the
    //    executables in the application directory instead of `/opt/...`.
    // 2. Do a text replace to determine the final sudoers file contents.
    // 3. Compare the contents with the existing file, and request a write if
    //    it's not the same.

    // Rewrite the network configuration to use application directory executables.
    await this.installCustomLimaNetworkConfig(vmnet, true, true);
    const unsafeSudoers = await this.limaWithCapture('sudoers');
    const sudoers = this.replaceVMNetExecutables(unsafeSudoers);
    let updateSudoers = false;

    try {
      const existing = await fs.promises.readFile(LIMA_SUDOERS_LOCATION, { encoding: 'utf-8' });

      const expectedLines = sudoers.split(/(?:\r?\n)+/).map(line => line.trim());
      const actualLines = existing.split(/(?:\r?\n)+/).map(line => line.trim());

      for (const [index, [expected, actual]] of Object.entries(zip(expectedLines, actualLines))) {
        if (expected !== actual) {
          console.log(`${ LIMA_SUDOERS_LOCATION } mismatch on line ${ index + 1 }:\nexpected ${ expected } \n but got ${ actual }`);
          updateSudoers = true;
          break;
        }
      }
    } catch (ex: any) {
      if (ex?.code !== 'ENOENT') {
        throw ex;
      }
      updateSudoers = true;
      console.debug(`Sudoers file ${ LIMA_SUDOERS_LOCATION } does not exist, creating.`);
    }

    if (updateSudoers) {
      const tmpFile = path.join(os.tmpdir(), `rd-sudoers${ randomTag }.txt`);

      await fs.promises.writeFile(tmpFile, sudoers, { mode: 0o644 });
      commands.push(`cp "${ tmpFile }" ${ LIMA_SUDOERS_LOCATION } && rm -f "${ tmpFile }"`);
      paths.push(LIMA_SUDOERS_LOCATION);
      console.debug(`Sudoers file ${ LIMA_SUDOERS_LOCATION } needs to be updated.`);
    }

    // Rewrite network config again to use the proper executables
    await this.installCustomLimaNetworkConfig(vmnet, true, false);

    if (commands.length > 0) {
      return {
        reason: 'networking', commands, paths,
      };
    }
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
    if (this.cfg.containerEngine.name !== ContainerEngine.MOBY) {
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

  /** Paths for the VMNet executables, in the root-owned directory. */
  protected safeVMNetExecutables = {
    vdeSwitch:   NETWORKS_CONFIG.paths.vdeSwitch as string,
    vdeVMNet:    NETWORKS_CONFIG.paths.vdeVMNet as string,
    socketVMNet: NETWORKS_CONFIG.paths.socketVMNet as string,
  } as const;

  /**
   * Paths for the VMNet executables, from the (user-writeable) application
   * directory.  We use these temporarily for limactl to generate the sudoers
   * file, but they are not actually executed from here.
   */
  protected unsafeVMNetExectuables = {
    vdeSwitch:   path.join(paths.resources, 'darwin/lima/vde/bin/vde_switch'),
    vdeVMNet:    path.join(paths.resources, 'darwin/lima/vde/bin/vde_vmnet'),
    socketVMNet: path.join(paths.resources, 'darwin/lima/socket_vmnet/bin/socket_vmnet'),
  } as const;

  /**
   * Given a sudoers file (contents), replace references to the "unsafe"
   * executables with the "safe" ones that are root-owned.
   */
  protected replaceVMNetExecutables(input: string): string {
    for (const key in this.safeVMNetExecutables) {
      const typedKey = key as 'vdeSwitch' | 'vdeVMNet' | 'socketVMNet';

      input = input.replaceAll(
        this.unsafeVMNetExectuables[typedKey],
        this.safeVMNetExecutables[typedKey]);
    }

    return input;
  }

  /**
   * Provide a default network config file with rancher-desktop specific settings.
   *
   * If there's an existing file, replace it if it doesn't contain a
   * paths.varRun setting for rancher-desktop
   */
  protected async installCustomLimaNetworkConfig(vmnet: VMNet, allowRoot = true, useUnsafeExecutables = false) {
    const networkPath = path.join(paths.lima, '_config', 'networks.yaml');

    let config: LimaNetworkConfiguration;

    try {
      config = yaml.parse(await fs.promises.readFile(networkPath, 'utf8'));
      if (config?.paths?.varRun !== NETWORKS_CONFIG.paths.varRun) {
        const backupName = networkPath.replace(/\.yaml$/, '.orig.yaml');

        await fs.promises.rename(networkPath, backupName);
        console.log(`Lima network configuration has unexpected contents; existing file renamed as ${ backupName }.`);
        config = clone(NETWORKS_CONFIG);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.log(`Existing networks.yaml file ${ networkPath } not yaml-parsable, got error ${ err }. It will be replaced.`);
      }
      config = clone(NETWORKS_CONFIG);
    }

    type executableKey = 'vdeSwitch' | 'vdeVMNet' | 'socketVMNet';
    /** Helper function to set a particular key. */
    const set = (key: executableKey) => {
      if (useUnsafeExecutables) {
        if (!config.paths[key] || config.paths[key] === this.safeVMNetExecutables[key]) {
          config.paths[key] = this.unsafeVMNetExectuables[key];
        }
      } else if (!config.paths[key] || config.paths[key] === this.unsafeVMNetExectuables[key]) {
        config.paths[key] = this.safeVMNetExecutables[key];
      }
    };

    if (vmnet === VMNet.VDE) {
      set('vdeSwitch');
      set('vdeVMNet');
      delete config.paths.socketVMNet;
    } else if (vmnet === VMNet.SOCKET) {
      // lima 0.12 deprecates vdeVMNet and adds support for socketVMNet
      set('socketVMNet');
      delete config.paths.vdeSwitch;
      delete config.paths.vdeVMNet;
    } else {
      throw new BackendError('Invalid Configuration', `Unexpected VMNet value ${ vmnet }`, true);
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

  protected async configureContainerd(): Promise<void> {
    const workdir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rd-containerd-install-'));

    try {
      await this.writeFile('/usr/local/bin/nerdctl', NERDCTL, 0o755);

      await this.execCommand({ root: true }, 'mkdir', '-p', '/etc/cni/net.d');

      if (this.cfg.kubernetes.options.flannel) {
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
  async writeFile(filePath: string, fileContents: string, permissions: fs.Mode = 0o644) {
    const workdir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `rd-${ path.basename(filePath) }-`));
    const tempPath = `/tmp/${ path.basename(workdir) }.${ path.basename(filePath) }`;

    try {
      const scriptPath = path.join(workdir, path.basename(filePath));

      await fs.promises.writeFile(scriptPath, fileContents, 'utf-8');
      await this.lima('copy', scriptPath, `${ MACHINE_NAME }:${ tempPath }`);
      await this.execCommand('chmod', permissions.toString(8), tempPath);
      await this.execCommand({ root: true }, 'mv', tempPath, filePath);
    } finally {
      await fs.promises.rm(workdir, { recursive: true });
      await this.execCommand({ root: true }, 'rm', '-f', tempPath);
    }
  }

  /**
   * Get IPv4 address for specified interface.
   */
  async getInterfaceAddr(iface: string) {
    try {
      const ipAddr = await this.execCommand({ capture: true },
        'ip', '--family', 'inet', 'addr', 'show', iface);
      const match = ipAddr.match(' inet ([0-9.]+)');

      return match ? match[1] : '';
    } catch (ex: any) {
      console.error(`Could not get address for ${ iface }: ${ ex?.stderr || ex }`);

      return '';
    }
  }

  /**
   * Get the network interface to listen on for services; used for flannel
   * configuration.
   */
  async getListeningInterface() {
    const bridgedIP = await this.getInterfaceAddr('rd0');

    if (bridgedIP) {
      console.log(`Using ${ bridgedIP } on bridged network rd0`);

      return 'rd0';
    } else {
      const sharedIP = await this.getInterfaceAddr('rd1');

      if (this.cfg.application.adminAccess) {
        await this.noBridgedNetworkDialog(sharedIP);
      }
      if (sharedIP) {
        console.log(`Using ${ sharedIP } on shared network rd1`);

        return 'rd1';
      } else {
        console.log(`Neither bridged network rd0 nor shared network rd1 have an IPv4 address`);

        return 'eth0';
      }
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

  protected async writeBuildkitScripts() {
    await this.writeFile(`/etc/init.d/buildkitd`, SERVICE_BUILDKITD_INIT, 0o755);
    await this.writeFile(`/etc/conf.d/buildkitd`, SERVICE_BUILDKITD_CONF, 0o644);
  }

  protected async configureOpenResty(config: BackendSettings) {
    const imageAllowListConf = '/usr/local/openresty/nginx/conf/image-allow-list.conf';
    // TODO: don't use hardcoded IP address
    const resolver = 'resolver 192.168.5.3 ipv6=off;\n';

    await this.writeFile(`/usr/local/openresty/nginx/conf/nginx.conf`, NGINX_CONF, 0o644);
    await this.writeFile(`/usr/local/openresty/nginx/conf/resolver.conf`, resolver, 0o644);
    await this.writeFile('/etc/logrotate.d/openresty', LOGROTATE_OPENRESTY_SCRIPT, 0o644);
    if (config.containerEngine.imageAllowList.enabled) {
      const patterns = BackendHelper.createImageAllowListConf(config.containerEngine.imageAllowList);

      await this.writeFile(imageAllowListConf, patterns, 0o644);
    } else {
      await this.execCommand({ root: true }, 'rm', '-f', imageAllowListConf);
    }
  }

  /**
   * Write a configuration file for an OpenRC service.
   * @param service The name of the OpenRC service to configure.
   * @param settings A mapping of configuration values.  This should be shell escaped.
   */
  async writeConf(service: string, settings: Record<string, string>) {
    const contents = Object.entries(settings).map(([key, value]) => `${ key }="${ value }"\n`).join('');

    await this.writeFile(`/etc/conf.d/${ service }`, contents);
  }

  protected async installTrivy() {
    const trivyPath = path.join(paths.resources, 'linux', 'internal', 'trivy');

    await this.lima('copy', trivyPath, `${ MACHINE_NAME }:./trivy`);
    await this.execCommand({ root: true }, 'mv', './trivy', '/usr/local/bin/trivy');
  }

  protected async installGuestAgent(kubeVersion: semver.SemVer | undefined) {
    const guestAgentPath = path.join(paths.resources, 'linux', 'internal', 'rancher-desktop-guestagent');

    await Promise.all([
      (async() => {
        await this.lima('copy', guestAgentPath, `${ MACHINE_NAME }:./rancher-desktop-guestagent`);
        await this.execCommand({ root: true }, 'mv', './rancher-desktop-guestagent', '/usr/local/bin/rancher-desktop-guestagent');
      })(),
      this.writeFile('/etc/init.d/rancher-desktop-guestagent', SERVICE_GUEST_AGENT_INIT, 0o755),
      (async() => {
        const kube = K3sHelper.requiresPortForwardingFix(kubeVersion);

        await this.writeConf('rancher-desktop-guestagent', {
          GUESTAGENT_KUBERNETES: kube ? 'true' : 'false',
          GUESTAGENT_IPTABLES:   'false',
          GUESTAGENT_DEBUG:      this.debug ? 'true' : 'false',
        });
      })(),
    ]);
    await this.execCommand({ root: true }, '/sbin/rc-service', 'rancher-desktop-guestagent', 'restart');
  }

  /**
   * Start the VM.  If the machine is already started, this does nothing.
   * Note that this does not start k3s.
   * @precondition The VM configuration is correct.
   */
  protected async startVM() {
    const vmnet = this.cfg.virtualMachine?.experimental.socketVMNet ? VMNet.SOCKET : VMNet.VDE;
    let allowRoot = this.#adminAccess;

    // We need both the lima config + the lima network config to correctly check if we need sudo
    // access; but if it's denied, we need to regenerate both again to account for the change.
    allowRoot &&= await this.progressTracker.action('Asking for permission to run tasks as administrator', 100, this.installToolsWithSudo(vmnet));

    if (!allowRoot) {
      // sudo access was denied; re-generate the config.
      await this.progressTracker.action('Regenerating configuration to account for lack of permissions', 100, Promise.all([
        this.updateConfig(false),
        this.installCustomLimaNetworkConfig(vmnet, false),
      ]));
    }

    await this.progressTracker.action('Starting virtual machine', 100, async() => {
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

  async start(config_: BackendSettings): Promise<void> {
    const config = this.cfg = clone(config_);
    let kubernetesVersion: semver.SemVer | undefined;
    let isDowngrade = false;

    await this.setState(State.STARTING);
    this.currentAction = Action.STARTING;
    this.#adminAccess = config_.application.adminAccess ?? true;
    await this.progressTracker.action('Starting Backend', 10, async() => {
      try {
        await this.ensureArchitectureMatch();
        await Promise.all([
          this.progressTracker.action('Ensuring virtualization is supported', 50, this.ensureVirtualizationSupported()),
          this.progressTracker.action('Updating cluster configuration', 50, this.updateConfig()),
        ]);

        if (this.currentAction !== Action.STARTING) {
          // User aborted before we finished
          return;
        }

        // Start the VM; if it's already running, this does nothing.
        const isVMAlreadyRunning = (await this.status)?.status === 'Running';

        await this.startVM();

        if (config.kubernetes.enabled) {
          [kubernetesVersion, isDowngrade] = await this.kubeBackend.download(config);

          if (typeof (kubernetesVersion) === 'undefined') {
            // The desired version was unavailable, and the user declined a downgrade.
            await this.setState(State.ERROR);

            return;
          }
        }

        if (this.currentAction !== Action.STARTING) {
          // User aborted before we finished
          return;
        }

        if ((await this.status)?.status === 'Running') {
          await this.progressTracker.action('Stopping existing instance', 100, async() => {
            await this.kubeBackend.stop();
            if (isDowngrade && isVMAlreadyRunning) {
              // If we're downgrading, stop the VM (and start it again immediately),
              // to ensure there are no containers running (so we can delete files).
              await this.lima('stop', MACHINE_NAME);
              await this.startVM();
            }
          });
        }

        if (this.currentAction !== Action.STARTING) {
          // User aborted before we finished
          return;
        }

        if (kubernetesVersion) {
          await this.kubeBackend.deleteIncompatibleData(kubernetesVersion);
        }

        await Promise.all([
          this.progressTracker.action('Installing CA certificates', 50, this.installCACerts()),
          this.progressTracker.action('Configuring image proxy', 50, this.configureOpenResty(config)),
          this.progressTracker.action('Configuring containerd', 50, this.configureContainerd()),
        ]);

        if (config.containerEngine.imageAllowList.enabled) {
          await this.startService('openresty');
        }
        if (config.containerEngine.name === ContainerEngine.CONTAINERD) {
          await this.startService('containerd');
        } else if (config.containerEngine.name === ContainerEngine.MOBY) {
          await this.startService('docker');
        }
        if (kubernetesVersion) {
          await this.kubeBackend.install(config, kubernetesVersion, this.#adminAccess);
        }

        await this.progressTracker.action('Installing Buildkit', 50, this.writeBuildkitScripts());
        await Promise.all([
          this.progressTracker.action('Installing image scanner', 50, this.installTrivy()),
          this.progressTracker.action('Installing credential helper', 50, this.installCredentialHelper()),
          this.progressTracker.action('Installing guest agent', 50, this.installGuestAgent(kubernetesVersion)),
          this.progressTracker.action('Fixing binfmt_misc qemu', 50, async() => {
            await this.writeFile('/etc/conf.d/qemu-binfmt', 'binfmt_flags="POCF"');
            await this.execCommand({ root: true }, '/sbin/rc-service', 'qemu-binfmt', 'restart');
          }),
        ]);

        if (this.currentAction !== Action.STARTING) {
          // User aborted
          return;
        }

        /** k3sEndpoint is the Kubernetes endpoint we want to use for the docker config. */
        let k3sEndpoint: string | undefined;

        if (kubernetesVersion) {
          k3sEndpoint = await this.kubeBackend.start(config, kubernetesVersion);
        }

        if (config.containerEngine.name === ContainerEngine.MOBY) {
          await this.dockerDirManager.ensureDockerContextConfigured(
            this.#adminAccess,
            path.join(paths.altAppHome, 'docker.sock'),
            k3sEndpoint);
        } else if (config.containerEngine.name === ContainerEngine.CONTAINERD) {
          await this.execCommand({ root: true }, '/sbin/rc-service', '--ifnotstarted', 'buildkitd', 'start');
        }

        await this.setState(config.kubernetes.enabled ? State.STARTED : State.DISABLED);
      } catch (err) {
        console.error('Error starting lima:', err);
        await this.setState(State.ERROR);
        if (err instanceof BackendError) {
          if (!err.fatal) {
            return;
          }
        }
        throw err;
      } finally {
        this.currentAction = Action.NONE;
      }
    });
  }

  protected async startService(serviceName: string) {
    await this.progressTracker.action(`Starting ${ serviceName }`, 50, async() => {
      await this.execCommand({ root: true }, '/sbin/rc-service', '--ifnotstarted', serviceName, 'start');
    });
  }

  protected async installCACerts(): Promise<void> {
    const certs: (string | Buffer)[] = await new Promise((resolve) => {
      mainEvents.once('cert-ca-certificates', resolve);
      mainEvents.emit('cert-get-ca-certificates');
    });

    const workdir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rd-ca-'));

    try {
      await this.execCommand({ root: true }, '/bin/sh', '-c', 'rm -f /usr/local/share/ca-certificates/rd-*.crt');

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
        await this.execCommand({ root: true }, 'tar', 'xf', '/tmp/certs.tar', '-C', '/usr/local/share/ca-certificates/');
      }
    } finally {
      await fs.promises.rm(workdir, { recursive: true, force: true });
    }
    await this.execCommand({ root: true }, 'update-ca-certificates');
  }

  protected async getHostIPAddr(): Promise<string> {
    try {
      const maxAttempt = 13;
      let stdout = '';

      for (let attempt = 0; attempt < maxAttempt; ++attempt) {
        stdout = await this.execCommand({ capture: true }, 'ip', 'route', 'list', 'eth0');
        const line = stdout.split(/\n/).find(line => /\bvia .* dev eth0\b/.test(line));
        const match = /\bvia (.*) dev eth0\b/.exec(line ?? '');

        if (match) {
          return match[1];
        }

        if (attempt < maxAttempt - 1) {
          // Do exponential backoff, with the last delay at around 3.5 minutes.
          // Skip after the last attempt, though.
          await util.promisify(setTimeout)(Math.pow(2, attempt) * 100);
        }
      }

      console.error(`Failed to get host IP address; last output:\n${ stdout }`);
      throw new Error(`Failed to get host IP address`);
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
        .replace(/'/g, "\\'");
      // leading `$` is needed to escape single-quotes, as : $'abc\'xyz'
      const leadingDollarSign = stateInfo.password.includes("'") ? '$' : '';
      const fileContents = `CREDFWD_AUTH=${ leadingDollarSign }'${ stateInfo.user }:${ escapedPassword }'
CREDFWD_URL='http://${ hostIPAddr }:${ stateInfo.port }'
`;
      const defaultConfig = { credsStore: 'rancher-desktop' };
      let existingConfig: Record<string, any>;

      await this.execCommand({ root: true }, 'mkdir', '-p', ETC_RANCHER_DESKTOP_DIR);
      await this.writeFile(CREDENTIAL_FORWARDER_SETTINGS_PATH, fileContents, 0o644);
      await this.writeFile(DOCKER_CREDENTIAL_PATH, DOCKER_CREDENTIAL_SCRIPT, 0o755);
      try {
        existingConfig = JSON.parse(await this.execCommand({ capture: true, root: true }, 'cat', ROOT_DOCKER_CONFIG_PATH));
      } catch (err: any) {
        await this.execCommand({ root: true }, 'mkdir', '-p', ROOT_DOCKER_CONFIG_DIR);
        existingConfig = {};
      }
      merge(existingConfig, defaultConfig);
      if (this.cfg.containerEngine.name === ContainerEngine.CONTAINERD) {
        existingConfig = BackendHelper.ensureDockerAuth(existingConfig);
      }
      await this.writeFile(ROOT_DOCKER_CONFIG_PATH, jsonStringifyWithWhiteSpace(existingConfig), 0o644);
    } catch (err: any) {
      console.log('Error trying to create/update docker credential files:', err);
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

    await this.progressTracker.action('Stopping services', 10, async() => {
      try {
        await this.setState(State.STOPPING);

        const status = await this.status;

        if (defined(status) && status.status === 'Running') {
          if (this.cfg.kubernetes.enabled) {
            try {
              await this.execCommand({ root: true, expectFailure: true }, '/sbin/rc-service', '--ifstarted', 'k3s', 'stop');
            } catch (ex) {
              console.error('Failed to stop k3s while stopping services: ', ex);
            }
          }
          await this.execCommand({ root: true }, '/sbin/rc-service', '--ifstarted', 'buildkitd', 'stop');
          await this.execCommand({ root: true }, '/sbin/rc-service', '--ifstarted', 'docker', 'stop');
          await this.execCommand({ root: true }, '/sbin/rc-service', '--ifstarted', 'containerd', 'stop');
          await this.execCommand({ root: true }, '/sbin/rc-service', '--ifstarted', 'openresty', 'stop');
          await this.execCommand({ root: true }, '/sbin/fstrim', '/mnt/data');
          await this.lima('stop', MACHINE_NAME);
          await this.dockerDirManager.clearDockerContext();
        }
        await this.setState(State.STOPPED);
      } catch (ex) {
        await this.setState(State.ERROR);
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
        await this.progressTracker.action(
          'Deleting Kubernetes VM',
          10,
          this.lima(...delArgs));
      }
    } catch (ex) {
      await this.setState(State.ERROR);
      throw ex;
    }

    this.cfg = defaultSettings;
  }

  async reset(config: BackendSettings): Promise<void> {
    await this.progressTracker.action('Resetting Kubernetes', 5, async() => {
      await this.stop();
      // Start the VM, so that we can delete files.
      await this.startVM();
      await this.kubeBackend.reset();
      await this.start(config);
    });
  }

  async requiresRestartReasons(cfg: BackendSettings): Promise<RestartReasons> {
    const GiB = 1024 * 1024 * 1024;
    const limaConfig = await this.getLimaConfig();
    const reasons: RestartReasons = {};

    if (!this.cfg) {
      return reasons; // No need to restart if nothing exists
    }
    if (process.platform === 'darwin') {
      if (typeof cfg.virtualMachine.experimental.socketVMNet !== 'undefined') {
        if (this.cfg.virtualMachine.experimental.socketVMNet !== cfg.virtualMachine.experimental.socketVMNet) {
          reasons['virtualMachine.experimental.socketVMNet'] = {
            current:  this.cfg.virtualMachine.experimental.socketVMNet,
            desired:  cfg.virtualMachine.experimental.socketVMNet,
            severity: 'restart',
          };
        }
      }
    }
    if (limaConfig) {
      Object.assign(reasons, await this.kubeBackend.requiresRestartReasons(this.cfg, cfg, {
        'virtualMachine.numberCPUs': { current: limaConfig.cpus ?? 2 },
        'virtualMachine.memoryInGB': { current: (limaConfig.memory ?? 4 * GiB) / GiB },
      }));
    }

    return reasons;
  }

  async getFailureDetails(exception: any): Promise<FailureDetails> {
    const logfile = console.path;
    const logLines = (await fs.promises.readFile(logfile, 'utf-8')).split('\n').slice(-10);

    return {
      lastCommand:        exception[childProcess.ErrorCommand],
      lastCommandComment: getProgressErrorDescription(exception) ?? 'Unknown',
      lastLogLines:       logLines,
    };
  }

  // #region Events
  eventNames(): Array<keyof BackendEvents> {
    return super.eventNames() as Array<keyof BackendEvents>;
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
