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

import { ContainerEngine, Settings } from '@/config/settings';
import * as childProcess from '@/utils/childProcess';
import Logging from '@/utils/logging';
import paths from '@/utils/paths';
import resources from '@/resources';
import DEFAULT_CONFIG from '@/assets/lima-config.yaml';
import NETWORKS_CONFIG from '@/assets/networks-config.yaml';
import INSTALL_K3S_SCRIPT from '@/assets/scripts/install-k3s';
import SERVICE_K3S_SCRIPT from '@/assets/scripts/service-k3s.initd';
import LOGROTATE_K3S_SCRIPT from '@/assets/scripts/logrotate-k3s';
import mainEvents from '@/main/mainEvents';
import UnixlikeIntegrations from '@/k8s-engine/unixlikeIntegrations';
import K3sHelper, { ShortVersion } from './k3sHelper';
import ProgressTracker from './progressTracker';
import * as K8s from './k8s';

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
  portForwards?: Array<Record<string, any>>;
  networks?: Array<Record<string, string>>;

  // The rest of the keys are not used by lima, just state we keep with the VM.
  k3s?: {
    version: string;
  }
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

const console = Logging.lima;
const DEFAULT_DOCKER_SOCK_LOCATION = '/var/run/docker.sock';
const MACHINE_NAME = '0';
const IMAGE_VERSION = '0.2.2';
const ALPINE_EDITION = 'rd';
const ALPINE_VERSION = '3.14.3';
const INTERFACE_NAME = 'rd0';

/** The following files, and their parents up to /, must only be writable by root,
 *  and none of them are allowed to be symlinks (lima-vm requirements).
 */
const VDE_DIR = '/opt/rancher-desktop';
const RUN_LIMA_LOCATION = '/private/var/run/rancher-desktop-lima';
const LIMA_SUDOERS_LOCATION = '/private/etc/sudoers.d/rancher-desktop-lima';

function defined<T>(input: T | null | undefined): input is T {
  return input !== null && typeof input !== 'undefined';
}

export default class LimaBackend extends events.EventEmitter implements K8s.KubernetesBackend {
  constructor(arch: K8s.Architecture) {
    super();
    this.arch = arch;
    this.k3sHelper = new K3sHelper(arch);
    this.k3sHelper.on('versions-updated', () => this.emit('versions-updated'));
    this.k3sHelper.initialize().catch((err) => {
      console.log('k3sHelper.initialize failed: ', err);
    });

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

  /** The name of the shared lima interface from the config file */
  #externalInterfaceName = '';

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

  protected unixlikeIntegrations = new UnixlikeIntegrations();

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

  progress: K8s.KubernetesProgress = { current: 0, max: 0 };

  /** Process for tailing logs */
  protected logProcess: childProcess.ChildProcess | null = null;

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
      /* The `file` command returns "... executable arm64" or "... executable x86_64" */
      const expectedArch = this.arch === 'aarch64' ? 'arm64' : this.arch;
      const { stdout } = await childProcess.spawnFile(
        'file', [this.limactl],
        { stdio: ['inherit', 'pipe', console] });

      if (!stdout.trim().match(`executable ${ expectedArch }$`)) {
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
    return resources.get(os.platform(), `alpine-lima-v${ IMAGE_VERSION }-${ ALPINE_EDITION }-${ ALPINE_VERSION }.iso`);
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
  protected async updateConfig(desiredVersion: semver.SemVer) {
    const currentConfig = await this.currentConfig;
    const baseConfig: Partial<LimaConfiguration> = currentConfig || {};
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
      ssh: { localPort: await this.sshPort },
      k3s: { version: desiredVersion.version },
    });

    this.updateConfigPortForwards(config);
    if (currentConfig) {
      // update existing configuration
      const configPath = path.join(paths.lima, MACHINE_NAME, 'lima.yaml');

      await this.progressTracker.action(
        'Updating outdated virtual machine',
        100,
        this.updateBaseDisk(currentConfig)
      );
      await fs.promises.writeFile(configPath, yaml.stringify(config), 'utf-8');
    } else {
      // new configuration
      await fs.promises.mkdir(path.dirname(this.CONFIG_PATH), { recursive: true });
      await fs.promises.writeFile(this.CONFIG_PATH, yaml.stringify(config));
      if (os.platform().startsWith('darwin')) {
        await childProcess.spawnFile('tmutil', ['addexclusion', paths.lima]);
      }
    }
    this.#externalInterfaceName = config.networks?.find(entry => (('lima' in entry) && ('interface' in entry)) )?.interface ?? INTERFACE_NAME;
  }

  protected updateConfigPortForwards(config: LimaConfiguration) {
    let allPortForwards: Array<Record<string, any>> | undefined = config.portForwards;

    if (!allPortForwards) {
      // This shouldn't happen, but fix it anyway
      config.portForwards = allPortForwards = DEFAULT_CONFIG.portForwards ?? [];
    }
    const dockerPortForwards = allPortForwards?.find(entry => Object.keys(entry).length === 2 &&
      entry.guestSocket === '/var/run/docker.sock' &&
      ('hostSocket' in entry));

    if (!dockerPortForwards) {
      config.portForwards?.push({
        guestSocket: '/var/run/docker.sock',
        hostSocket:  'docker',
      });
    }
  }

  protected get currentConfig(): Promise<LimaConfiguration | undefined> {
    return (async() => {
      try {
        const configPath = path.join(paths.lima, MACHINE_NAME, 'lima.yaml');
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
    const vdeDir = path.join(VDE_DIR, 'bin');
    const pathList = (process.env.PATH || '').split(path.delimiter);
    const newPath = [binDir, vdeDir].concat(...pathList).filter(x => x);

    return {
      ...process.env, LIMA_HOME: paths.lima, PATH: newPath.join(path.delimiter)
    };
  }

  protected async lima(...args: string[]): Promise<void> {
    try {
      await childProcess.spawnFile(this.limactl, args,
        { env: this.limaEnv, stdio: console });
    } catch (ex) {
      console.error(`+ limactl ${ args.join(' ') }`);
      console.error(ex);
      throw ex;
    }
  }

  protected async limaWithCapture(...args: string[]): Promise<string> {
    const { stdout } = await childProcess.spawnFile(this.limactl, args,
      { env: this.limaEnv, stdio: ['ignore', 'pipe', console] });

    return stdout;
  }

  limaSpawn(args: string[]): ChildProcess {
    args = ['shell', '--workdir=.', MACHINE_NAME].concat(args);

    return spawnWithSignal(this.limactl, args, { env: this.limaEnv });
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
    return Math.random().toString().substr(2, desiredLength);
  }

  protected async showSudoReason(explanations: Array<string>): Promise<void> {
    const bullet = '* ';
    const suffix = explanations.length > 1 ? 's' : '';
    const options: Electron.MessageBoxOptions = {
      message: `Rancher Desktop needs root access to configure its internal network by populating the following location${ suffix }:`,
      type:    'info',
      buttons: ['OK'],
      title:   "We'll be asking you to type in your password in the next dialog box.",
      detail:  `${ bullet }${ explanations.join(`\n${ bullet }`) }`,
    };

    await Electron.dialog.showMessageBox(options);
  }

  /**
   * Install the vde_vmnet binaries in to /opt/rancher-desktop if required.
   * Note that this may request the root password.
   */
  protected async installToolsWithSudo() {
    const randomTag = LimaBackend.calcRandomTag(8);
    const commands: Array<string> = [];
    const explanations: Array<string> = [];

    await this.installVDETools(commands, explanations);
    await this.ensureRunLimaLocation(commands, explanations);
    await this.createLimaSudoersFile(commands, explanations, randomTag);
    await this.configureDockerSocket(commands, explanations);

    if (commands.length === 0) {
      return;
    }
    await this.showSudoReason(explanations);

    const tmpScript = path.join(os.tmpdir(), `rd-sudo-commands-${ randomTag }.sh`);
    const logFile = path.join(os.tmpdir(), `rd-sudo-commands-run-${ randomTag }.log`);

    await fs.promises.writeFile(tmpScript, `#!/usr/bin/env bash

exec &> >(tee ${ logFile })
set -ex

${ commands.join('\n') }
`,
    { mode: 0o700 });
    try {
      await this.sudoExec(tmpScript);
    } catch (err) {
      if (err.toString().includes('User did not grant permission')) {
        throw new K8s.KubernetesError('Error Starting Kubernetes', err, true);
      }
      throw err;
    }
    // If there were no errors delete the script and log file
    fs.promises.unlink(tmpScript).catch((err) => {
      console.log(`Error deleting temporary script file ${ tmpScript }`, err);
    });
    fs.promises.unlink(logFile).catch((err) => {
      console.log(`Error deleting sudo script log output ${ logFile }`, err);
    });
  }

  protected async installVDETools(commands: Array<string>, explanations: Array<string>): Promise<void> {
    const sourcePath = resources.get(os.platform(), 'lima', 'vde');
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
    explanations.push(VDE_DIR);
  }

  protected async createLimaSudoersFile(commands: Array<string>, explanations: Array<string>, randomTag: string): Promise<void> {
    try {
      await this.lima('sudoers', '--check');

      return;
    } catch (_) {
    }
    // Here we have to run `lima sudoers` as non-root and grab the output, and then
    // copy it to the target sudoers file as root
    const data = await this.limaWithCapture('sudoers');
    const tmpFile = path.join(os.tmpdir(), `rd-sudoers${ randomTag }.txt`);

    await fs.promises.writeFile(tmpFile, data.toString(), { mode: 0o644 });
    console.log(`need to limactl sudoers, get data from ${ tmpFile }`);
    commands.push(`cp "${ tmpFile }" ${ LIMA_SUDOERS_LOCATION } && rm -f "${ tmpFile }"`);
    explanations.push(LIMA_SUDOERS_LOCATION);
  }

  protected async ensureRunLimaLocation(commands: Array<string>, explanations: Array<string>): Promise<void> {
    let dirInfo: fs.Stats | null;

    try {
      dirInfo = await fs.promises.stat(RUN_LIMA_LOCATION);

      // If it's owned by root and not readable by others, it's fine
      if (dirInfo.uid === 0 && (dirInfo.mode & fs.constants.S_IWOTH) === 0) {
        return;
      }
    } catch (err) {
      dirInfo = null;
      if (err.code !== 'ENOENT') {
        console.log(`Unexpected situation with ${ RUN_LIMA_LOCATION }, stat => error ${ err }`, err);
        throw err;
      }
    }
    if (!dirInfo) {
      commands.push(`mkdir -p ${ RUN_LIMA_LOCATION }`);
      commands.push(`chmod 755 ${ RUN_LIMA_LOCATION }`);
    }
    commands.push(`chown -R root:daemon ${ RUN_LIMA_LOCATION }`);
    commands.push(`chmod -R u-w ${ RUN_LIMA_LOCATION }`);
    explanations.push(RUN_LIMA_LOCATION);
  }

  protected async configureDockerSocket(commands: Array<string>, explanations: Array<string>): Promise<void> {
    if (this.#currentContainerEngine !== ContainerEngine.MOBY) {
      return;
    }
    const realPath = await this.evalSymlink(DEFAULT_DOCKER_SOCK_LOCATION);
    const targetPath = path.join(paths.lima, MACHINE_NAME, 'sock', 'docker');

    if (realPath === targetPath) {
      return;
    }

    commands.push(`ln -sf "${ targetPath }" "${ DEFAULT_DOCKER_SOCK_LOCATION }"`);
    explanations.push(DEFAULT_DOCKER_SOCK_LOCATION);
  }

  protected async evalSymlink(path: string): Promise<string> {
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
      if (err.code !== 'ENOENT') {
        console.log(`Error trying to resolve symbolic link ${ path }:`, err);
      }
    }

    return path;
  }

  /**
   * Use the sudo-prompt library to run the script as root
   * @param command: Path to an executable file
   */
  protected async sudoExec(command: string) {
    await new Promise<void>((resolve, reject) => {
      sudo.exec(command, { name: 'Rancher Desktop', icns: resources.get('icons', 'logo-square-512.png') }, (error, stdout, stderr) => {
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
  protected async installCustomLimaNetworkConfig() {
    const networkPath = path.join(paths.lima, '_config', 'networks.yaml');

    try {
      const data = yaml.parse(await fs.promises.readFile(networkPath, 'utf8'));
      const runFile = data?.paths?.varRun ?? '';

      if (runFile.includes('/rancher-desktop')) {
        // Assume if there's a paths.varRun setting mentioning "rancher-desktop" there's no need to replace it.
        return;
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.log(`Existing networks.yaml file ${ networkPath } not yaml-parsable, got error ${ err }. It will be replaced.`);
      }
    }
    await fs.promises.writeFile(networkPath, yaml.stringify(NETWORKS_CONFIG), { encoding: 'utf-8' });
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
      await fs.promises.chmod(path.join(paths.cache, 'k3s', version.raw, k3s), 0o755);
      await this.ssh('sudo', 'bin/install-k3s', version.raw, path.join(paths.cache, 'k3s'));
      await this.lima('copy', resources.get('scripts', 'profile'), `${ MACHINE_NAME }:~/.profile`);
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
   * Write the openrc script for k3s.
   */
  protected async writeServiceScript() {
    await this.writeFile('/etc/init.d/k3s', SERVICE_K3S_SCRIPT, 0o755);
    await this.writeConf('k3s', {
      PORT:   this.desiredPort.toString(),
      ENGINE: this.#currentContainerEngine,
    });
    await this.writeFile('/etc/logrotate.d/k3s', LOGROTATE_K3S_SCRIPT);
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
    await this.lima('copy', resources.get('linux', 'bin', 'trivy'), `${ MACHINE_NAME }:./trivy`);
    await this.ssh('sudo', 'mv', './trivy', '/usr/local/bin/trivy');
  }

  protected async followLogs() {
    try {
      this.logProcess?.kill('SIGTERM');
    } catch (ex) { }
    this.logProcess = childProcess.spawn(
      this.limactl,
      ['shell', '--workdir=.', MACHINE_NAME,
        '/usr/bin/tail', '-n+1', '-F', '/var/log/k3s.log'],
      {
        env:   this.limaEnv,
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
      await this.progressTracker.action(
        'Deleting incompatible Kubernetes state',
        100,
        this.k3sHelper.deleteKubeState((...args: string[]) => this.ssh('sudo', ...args)));
    }
  }

  /**
   * Start the VM.  If the machine is already started, this does nothing.
   * Note that this does not start k3s.
   * @precondtion The VM configuration is correct.
   */
  protected async startVM() {
    await this.progressTracker.action('Installing networking requirements', 100, async() => {
      await this.installCustomLimaNetworkConfig();
      await this.installToolsWithSudo();
    });
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
      }
    });
  }

  async start(config: Settings['kubernetes']): Promise<void> {
    this.cfg = config;
    const desiredVersion = await this.desiredVersion;
    const previousVersion = (await this.currentConfig)?.k3s?.version;
    const isDowngrade = previousVersion ? semver.gt(previousVersion, desiredVersion) : false;

    this.#desiredPort = config.port;
    this.setState(K8s.State.STARTING);
    this.currentAction = Action.STARTING;
    if (this.cfg?.containerEngine) {
      this.#currentContainerEngine = this.cfg.containerEngine;
    }

    await this.progressTracker.action('Starting kubernetes', 10, async() => {
      try {
        await this.ensureArchitectureMatch();
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

        await Promise.all([
          this.progressTracker.action('Checking k3s images', 100, this.k3sHelper.ensureK3sImages(desiredVersion)),
          this.progressTracker.action('Ensuring virtualization is supported', 50, this.ensureVirtualizationSupported()),
          this.progressTracker.action('Updating cluster configuration', 50, this.updateConfig(desiredVersion)),
        ]);

        if (this.currentAction !== Action.STARTING) {
          // User aborted before we finished
          return;
        }

        // We have no good estimate for the rest of the steps, go indeterminate.
        timers.clearInterval(this.progressInterval);
        this.progressInterval = undefined;

        if ((await this.status)?.status === 'Running') {
          await this.progressTracker.action('Stopping existing instance', 100, async() => {
            await this.ssh('sudo', '/sbin/rc-service', 'k3s', 'stop');
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
        await Promise.all([
          this.progressTracker.action('Installing k3s', 50, async() => {
            await this.installK3s(desiredVersion);
            await this.writeServiceScript();
          }),
          this.progressTracker.action('Installing image scanner', 50, this.installTrivy()),
          this.progressTracker.action('Installing CA certificates', 50, this.installCACerts()),
        ]);

        if (os.platform() === 'darwin') {
          await this.progressTracker.action('Installing tools', 30, this.installToolsWithSudo());
        }

        if (this.currentAction !== Action.STARTING) {
          // User aborted
          return;
        }

        if (this.#currentContainerEngine === ContainerEngine.MOBY) {
          await this.progressTracker.action('Starting docker server', 30, async() => {
            await this.ssh('sudo', '/sbin/rc-service', 'docker', 'start');
            this.ssh('sudo', 'sh', '-c',
              'while [ ! -S /var/run/docker.sock ] ; do sleep 1 ; done; chmod a+rw /var/run/docker.sock').catch((err) => {
              console.log('Error trying to chmod /var/run/docker.sock: ', err);
            });
          });
        }

        await this.progressTracker.action('Starting k3s', 100, async() => {
          await this.ssh('sudo', '/sbin/rc-service', '--ifnotstarted', 'k3s', 'start');
          await this.followLogs();
        });

        await this.progressTracker.action(
          'Waiting for Kubernetes API',
          100,
          async() => {
            await this.k3sHelper.waitForServerReady(() => Promise.resolve('127.0.0.1'), this.#desiredPort);
            while (true) {
              if (this.currentAction !== Action.STARTING) {
                // User aborted
                return;
              }
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
          }
        );
        await this.progressTracker.action(
          'Updating kubeconfig',
          50,
          this.k3sHelper.updateKubeconfig(
            () => this.limaWithCapture('shell', '--workdir=.', MACHINE_NAME, 'sudo', 'cat', '/etc/rancher/k3s/k3s.yaml')));
        await this.progressTracker.action(
          'Waiting for services',
          50,
          async() => {
            this.client = new K8s.Client();
            await this.client.waitForServiceWatcher();
            this.client.on('service-changed', (services) => {
              this.emit('service-changed', services);
            });
          }
        );

        this.activeVersion = desiredVersion;
        this.currentPort = this.#desiredPort;
        this.emit('current-port-changed', this.currentPort);
        // Trigger kuberlr to ensure there's a compatible version of kubectl in place for the users
        // rancher-desktop mostly uses the K8s API instead of kubectl, so we need to invoke kubectl
        // to nudge kuberlr
        await childProcess.spawnFile(resources.executable('kubectl'),
          ['--context', 'rancher-desktop', 'cluster-info'],
          { stdio: Logging.k8s });

        await this.progressTracker.action(
          'Waiting for nodes',
          100,
          async() => {
            if (!await this.client?.waitForReadyNodes()) {
              throw new Error('No client');
            }
          });

        this.setState(K8s.State.STARTED);
      } catch (err) {
        console.error('Error starting lima:', err);
        this.setState(K8s.State.ERROR);
        throw err;
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
      await fs.promises.rmdir(workdir, { recursive: true });
    }
    await this.ssh('sudo', 'update-ca-certificates');
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

    if (this.#currentContainerEngine === ContainerEngine.MOBY) {
      await this.progressTracker.action('Stopping docker server', 30, async() => {
        try {
          await this.ssh('sudo', '/sbin/rc-service', 'docker', 'stop');
        } catch (ex) {
          console.log(`Error stopping docker: `, ex);
        }
      });
    }

    await this.progressTracker.action('Stopping Kubernetes', 10, async() => {
      try {
        this.setState(K8s.State.STOPPING);

        const status = await this.status;

        if (defined(status) && status.status === 'Running') {
          await this.ssh('sudo', '/sbin/rc-service', 'k3s', 'stop');
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
        await this.progressTracker.action(
          'Deleting Kubernetes VM',
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
    await this.progressTracker.action('Resetting Kubernetes', 5, async() => {
      await this.stop();
      // Start the VM, so that we can delete files.
      await this.startVM();
      await this.k3sHelper.deleteKubeState(
        (...args: string[]) => this.ssh('sudo', ...args));
      await this.start(config);
    });
  }

  async factoryReset(): Promise<void> {
    await this.del(true);
    await Promise.all([paths.cache, paths.lima, paths.config, paths.logs]
      .map(p => fs.promises.rmdir(p, { recursive: true })));
  }

  async requiresRestartReasons(): Promise<Record<string, [any, any] | []>> {
    if (this.currentAction !== Action.NONE || this.internalState === K8s.State.ERROR) {
      // If we're in the middle of starting or stopping, we don't need to restart.
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
    return null;
  }

  async listIntegrations(): Promise<Record<string, boolean | string>> {
    return await this.unixlikeIntegrations.listIntegrations();
  }

  listIntegrationWarnings(): void {
    this.unixlikeIntegrations.listIntegrationWarnings();
  }

  async setIntegration(linkPath: string, state: boolean): Promise<string | undefined> {
    return await this.unixlikeIntegrations.setIntegration(linkPath, state);
  }
}
