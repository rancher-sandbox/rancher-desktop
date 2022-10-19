import events from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import timers from 'timers';
import util from 'util';

import semver from 'semver';
import yaml from 'yaml';

import {
  Architecture, BackendEvents, BackendSettings, RestartReasons, State,
} from '../backend';
import K3sHelper, { ExtraRequiresReasons, NoCachedK3sVersionsError, ShortVersion } from '../k3sHelper';
import LimaBackend, { Action, MACHINE_NAME } from '../lima';

import INSTALL_K3S_SCRIPT from '@/assets/scripts/install-k3s';
import LOGROTATE_K3S_SCRIPT from '@/assets/scripts/logrotate-k3s';
import SERVICE_CRI_DOCKERD_SCRIPT from '@/assets/scripts/service-cri-dockerd.initd';
import SERVICE_K3S_SCRIPT from '@/assets/scripts/service-k3s.initd';
import { KubeClient } from '@/backend/client';
import { getImageProcessor } from '@/backend/images/imageFactory';
import * as K8s from '@/backend/k8s';
import { ContainerEngine } from '@/config/settings';
import mainEvents from '@/main/mainEvents';
import { checkConnectivity } from '@/main/networking';
import * as childProcess from '@/utils/childProcess';
import clone from '@/utils/clone';
import Logging from '@/utils/logging';
import paths from '@/utils/paths';
import { RecursivePartial } from '@/utils/typeUtils';
import { showMessageBox } from '@/window';

export default class LimaKubernetesBackend extends events.EventEmitter implements K8s.KubernetesBackend {
  constructor(arch: Architecture, vm: LimaBackend) {
    super();
    this.arch = arch;
    this.vm = vm;

    this.k3sHelper = new K3sHelper(arch);
    this.k3sHelper.on('versions-updated', () => this.emit('versions-updated'));
    this.k3sHelper.initialize().catch((err) => {
      console.log('k3sHelper.initialize failed: ', err);
    });
    mainEvents.on('network-ready', () => this.k3sHelper.networkReady());
  }

  /**
   * Download K3s images.  This will also calculate the version to download.
   * @precondition The VM must be running.
   * @returns The version of K3s images downloaded, and whether this is a
   * downgrade.
   */
  async download(cfg: BackendSettings): Promise<[semver.SemVer | undefined, boolean]> {
    this.cfg = cfg;
    const interval = timers.setInterval(() => {
      const statuses = [
        this.k3sHelper.progress.checksum,
        this.k3sHelper.progress.exe,
        this.k3sHelper.progress.images,
      ];
      const sum = (key: 'current' | 'max') => {
        return statuses.reduce((v, c) => v + c[key], 0);
      };

      const current = sum('current');
      const max = sum('max');

      this.progressTracker.numeric('Downloading Kubernetes components', current, max);
    });

    try {
      const persistedVersion = await K3sHelper.getInstalledK3sVersion(this.vm);
      const desiredVersion = await this.desiredVersion;
      const isDowngrade = (version: semver.SemVer | string) => {
        return !!persistedVersion && semver.gt(persistedVersion, version);
      };

      console.debug(`Download: desired=${ desiredVersion } persisted=${ persistedVersion }`);
      try {
        await this.progressTracker.action('Checking k3s images', 100, this.k3sHelper.ensureK3sImages(desiredVersion));

        return [desiredVersion, isDowngrade(desiredVersion)];
      } catch (ex) {
        if (!await checkConnectivity('github.com')) {
          throw ex;
        }

        try {
          const newVersion = await K3sHelper.selectClosestImage(desiredVersion);

          // Show a warning if we are downgrading from the desired version, but
          // only if it's not already a downgrade (where the user had already
          // accepted it).
          if (desiredVersion.compare(newVersion) > 0 && !isDowngrade(desiredVersion)) {
            const options: Electron.MessageBoxOptions = {
              message:   `Downgrading from ${ desiredVersion.raw } to ${ newVersion.raw } will lose existing Kubernetes workloads. Delete the data?`,
              type:      'question',
              buttons:   ['Delete Workloads', 'Cancel'],
              defaultId: 1,
              title:     'Confirming migration',
              cancelId:  1,
            };
            const result = await showMessageBox(options, true);

            if (result.response !== 0) {
              return [undefined, false];
            }
          }
          console.log(`Going with alternative version ${ newVersion.raw }`);

          return [newVersion, isDowngrade(newVersion)];
        } catch (ex: any) {
          if (ex instanceof NoCachedK3sVersionsError) {
            throw new K8s.KubernetesError('No version available', 'The k3s cache is empty and there is no network connection.');
          }
          throw ex;
        }
      }
    } finally {
      timers.clearInterval(interval);
    }
  }

  /**
   * Install the Kubernetes files.
   */
  async install(config: BackendSettings, desiredVersion: semver.SemVer, allowSudo: boolean) {
    await this.progressTracker.action('Installing k3s', 50, async() => {
      await this.deleteIncompatibleData(desiredVersion);
      await this.installK3s(desiredVersion);
      await this.writeServiceScript(config, allowSudo);
    });

    this.activeVersion = desiredVersion;
  }

  /**
   * Start Kubernetes.
   * @returns The Kubernetes endpoint
   */
  async start(config_: BackendSettings, kubernetesVersion: semver.SemVer): Promise<string> {
    const config = this.cfg = clone(config_);
    let k3sEndpoint = '';

    // Remove flannel config if necessary, before starting k3s
    if (!config.options.flannel) {
      await this.vm.execCommand({ root: true }, 'rm', '-f', '/etc/cni/net.d/10-flannel.conflist');
    }

    await this.progressTracker.action('Starting k3s', 100, async() => {
      // Run rc-update as we have dynamic dependencies.
      await this.vm.execCommand({ root: true }, '/sbin/rc-update', '--update');
      await this.vm.execCommand({ root: true }, '/sbin/rc-service', '--ifnotstarted', 'k3s', 'start');
      await this.followLogs();
    });

    await this.progressTracker.action(
      'Waiting for Kubernetes API',
      100,
      async() => {
        await this.k3sHelper.waitForServerReady(() => Promise.resolve('127.0.0.1'), config.port);
        while (true) {
          if (this.vm.currentAction !== Action.STARTING) {
            // User aborted
            return;
          }
          try {
            await this.vm.execCommand({ expectFailure: true }, 'ls', '/etc/rancher/k3s/k3s.yaml');
            break;
          } catch (ex) {
            console.log('Configuration /etc/rancher/k3s/k3s.yaml not present in lima vm; will check again...');
            await util.promisify(setTimeout)(1_000);
          }
        }
        console.debug('/etc/rancher/k3s/k3s.yaml is ready.');
      },
    );
    await this.progressTracker.action(
      'Updating kubeconfig',
      50,
      this.k3sHelper.updateKubeconfig(
        async() => {
          const k3sConfigString = await this.vm.execCommand({ capture: true, root: true }, 'cat', '/etc/rancher/k3s/k3s.yaml');
          const k3sConfig = yaml.parse(k3sConfigString);

          k3sEndpoint = k3sConfig?.clusters?.[0]?.cluster?.server;

          return k3sConfigString;
        }));

    this.client = new KubeClient();

    await this.progressTracker.action(
      'Waiting for services',
      50,
      async() => {
        const client = this.client as KubeClient;

        await client.waitForServiceWatcher();
        client.on('service-changed', (services) => {
          this.emit('service-changed', services);
        });
        client.on('service-error', (service, errorMessage) => {
          this.emit('service-error', service, errorMessage);
        });
      },
    );

    this.activeVersion = kubernetesVersion;
    this.currentPort = config.port;
    this.emit('current-port-changed', this.currentPort);

    // Remove traefik if necessary.
    if (!this.cfg?.options.traefik) {
      await this.progressTracker.action(
        'Removing Traefik',
        50,
        this.k3sHelper.uninstallTraefik(this.client));
    }

    await this.k3sHelper.getCompatibleKubectlVersion(this.activeVersion);
    if (this.cfg?.options.flannel) {
      await this.progressTracker.action(
        'Waiting for nodes',
        100,
        async() => {
          if (!await this.client?.waitForReadyNodes()) {
            throw new Error('No client');
          }
        });
    } else {
      await this.progressTracker.action(
        'Skipping node checks, flannel is disabled',
        100,
        async() => {
          await new Promise(resolve => setTimeout(resolve, 5000));
        });
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

    if (config.checkForExistingKimBuilder) {
      this.client ??= new KubeClient();
      await getImageProcessor(config.containerEngine, this.vm).removeKimBuilder(this.client.k8sClient);
      // No need to remove kim builder components ever again.
      this.vm.writeSetting({ checkForExistingKimBuilder: false });
      this.emit('kim-builder-uninstalled');
    }

    return k3sEndpoint;
  }

  protected async followLogs() {
    try {
      this.logProcess?.kill('SIGTERM');
    } catch (ex) { }
    this.logProcess = this.vm.spawn(
      { logStream: await Logging.k3s.fdStream },
      '/usr/bin/tail', '-n+1', '-F', '/var/log/k3s.log');
    this.logProcess.on('exit', (status, signal) => {
      this.logProcess = null;
      if (![Action.STARTING, Action.NONE].includes(this.vm.currentAction)) {
        // Allow the log process to exit if we're stopping
        return;
      }
      if (![State.STARTING, State.STARTED].includes(this.vm.state)) {
        // Allow the log process to exit if we're not active.
        return;
      }
      console.log(`Log process exited with ${ status }/${ signal }, restarting...`);
      setTimeout(this.followLogs.bind(this), 1_000);
    });
  }

  async stop() {
    if (this.cfg?.enabled) {
      try {
        const script = 'if [ -e /etc/init.d/k3s ]; then /sbin/rc-service --ifstarted k3s stop; fi';

        await this.vm.execCommand({ root: true, expectFailure: true }, '/bin/sh', '-c', script);
      } catch (ex) {
        console.error('Failed to stop k3s while stopping kube backend: ', ex);
      }
    }
    await this.cleanup();
  }

  cleanup(): Promise<void> {
    this.client?.destroy();

    return Promise.resolve();
  }

  async reset() {
    await this.k3sHelper.deleteKubeState(this.vm);
  }

  cfg: BackendSettings | undefined;

  protected readonly arch: Architecture;
  protected readonly vm: LimaBackend;
  protected activeVersion?: semver.SemVer;

  /** The port Kubernetes is actively listening on. */
  protected currentPort = 0;

  /** Helper object to manage available K3s versions. */
  protected readonly k3sHelper: K3sHelper;

  protected client: KubeClient | null = null;

  /** Process for tailing logs */
  protected logProcess: childProcess.ChildProcess | null = null;

  protected get progressTracker() {
    return this.vm.progressTracker;
  }

  get version(): ShortVersion {
    return this.activeVersion?.version ?? '';
  }

  get availableVersions(): Promise<K8s.VersionEntry[]> {
    return this.k3sHelper.availableVersions;
  }

  async cachedVersionsOnly(): Promise<boolean> {
    return await K3sHelper.cachedVersionsOnly();
  }

  get desiredPort() {
    return this.cfg?.port ?? 6443;
  }

  protected get desiredVersion(): Promise<semver.SemVer> {
    return (async() => {
      const availableVersions = (await this.k3sHelper.availableVersions).map(v => v.version);
      const storedVersion = semver.parse(this.cfg?.version);
      const version = storedVersion ?? availableVersions[0];

      if (!version) {
        throw new Error('No version available');
      }

      const matchedVersion = availableVersions.find(v => v.compare(version) === 0);

      if (matchedVersion) {
        if (!storedVersion) {
          // No (valid) stored version; save the selected one.
          this.vm.writeSetting({ version: matchedVersion.version });
        }

        return matchedVersion;
      }

      console.error(`Could not use saved version ${ version.raw }, not in ${ availableVersions }`);
      this.vm.writeSetting({ version: availableVersions[0].version });

      return availableVersions[0];
    })();
  }

  /**
   * Install K3s into the VM for execution.
   * @param version The version to install.
   */
  protected async installK3s(version: semver.SemVer) {
    const workdir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rd-k3s-install-'));

    try {
      const k3s = this.arch === 'aarch64' ? 'k3s-arm64' : 'k3s';

      await this.vm.execCommand('mkdir', '-p', 'bin');
      await this.vm.writeFile('bin/install-k3s', INSTALL_K3S_SCRIPT, 'a+x');
      await fs.promises.chmod(path.join(paths.cache, 'k3s', version.raw, k3s), 0o755);
      await this.vm.execCommand({ root: true }, 'bin/install-k3s', version.raw, path.join(paths.cache, 'k3s'));
      const profilePath = path.join(paths.resources, 'scripts', 'profile');

      await this.vm.lima('copy', profilePath, `${ MACHINE_NAME }:~/.profile`);
    } finally {
      await fs.promises.rm(workdir, { recursive: true });
    }
  }

  /**
   * Write the openrc script for k3s.
   */
  protected async writeServiceScript(cfg: BackendSettings, allowSudo: boolean) {
    const config: Record<string, string> = {
      PORT:            this.desiredPort.toString(),
      ENGINE:          cfg.containerEngine ?? ContainerEngine.NONE,
      ADDITIONAL_ARGS: '',
    };

    if (allowSudo && os.platform() === 'darwin') {
      if (cfg.options.flannel) {
        const iface = await this.vm.getListeningInterface();

        config.ADDITIONAL_ARGS += ` --flannel-iface ${ iface }`;
      } else {
        console.log(`Disabling flannel and network policy`);
        config.ADDITIONAL_ARGS += ' --flannel-backend=none --disable-network-policy';
      }
    }
    if (!cfg.options.traefik) {
      config.ADDITIONAL_ARGS += ' --disable traefik';
    }
    await this.vm.writeFile('/etc/init.d/cri-dockerd', SERVICE_CRI_DOCKERD_SCRIPT, 0o755);
    await this.vm.writeConf('cri-dockerd', {
      LOG_DIR:         paths.logs,
      ENGINE:  cfg.containerEngine ?? ContainerEngine.NONE,
    });
    await this.vm.writeFile('/etc/init.d/k3s', SERVICE_K3S_SCRIPT, 0o755);
    await this.vm.writeConf('k3s', config);
    await this.vm.writeFile('/etc/logrotate.d/k3s', LOGROTATE_K3S_SCRIPT);
  }

  /**
   * Delete k3s data that may cause issues if we were to move to the given
   * version.
   */
  protected async deleteIncompatibleData(desiredVersion: semver.SemVer) {
    const existingVersion = await K3sHelper.getInstalledK3sVersion(this.vm);

    if (!existingVersion) {
      return;
    }
    if (semver.gt(existingVersion, desiredVersion)) {
      await this.progressTracker.action(
        'Deleting incompatible Kubernetes state',
        100,
        this.k3sHelper.deleteKubeState(this.vm));
    }
  }

  async requiresRestartReasons(currentConfig: BackendSettings, desiredConfig: RecursivePartial<BackendSettings>, extra: ExtraRequiresReasons): Promise<RestartReasons> {
    // This is a placeholder to force this method to be async
    await Promise.all([]);

    return this.k3sHelper.requiresRestartReasons(
      currentConfig,
      desiredConfig,
      {
        version: (current: string, desired: string) => {
          if (semver.gt(current || '0.0.0', desired)) {
            return 'reset';
          }

          return 'restart';
        },
        port:              undefined,
        containerEngine:   undefined,
        enabled:           undefined,
        'options.traefik': undefined,
        'options.flannel': undefined,
        suppressSudo:      undefined,
      },
      extra,
    );
  }

  listServices(namespace?: string): K8s.ServiceEntry[] {
    return this.client?.listServices(namespace) || [];
  }

  async forwardPort(namespace: string, service: string, k8sPort: number | string, hostPort: number): Promise<number | undefined> {
    return await this.client?.forwardPort(namespace, service, k8sPort, hostPort);
  }

  async cancelForward(namespace: string, service: string, k8sPort: number | string): Promise<void> {
    await this.client?.cancelForwardPort(namespace, service, k8sPort);
  }

  // #region Events
  // #region Event forwarding

  protected eventForwarders: {
    [k in keyof BackendEvents]?: BackendEvents[k];
  } = {};

  addListener<eventName extends keyof K8s.KubernetesBackendEvents>(event: eventName, listener: K8s.KubernetesBackendEvents[eventName]): this {
    if (!(event in this.eventForwarders)) {
      const baseListener = (...args: any[]) => {
        this.emit(event, ...args);
      };

      this.vm.addListener(event, baseListener);
    }

    return super.addListener(event, listener);
  }

  on<eventName extends keyof K8s.KubernetesBackendEvents>(event: eventName, listener: K8s.KubernetesBackendEvents[eventName]): this {
    if (!(event in this.eventForwarders)) {
      const baseListener = (...args: any[]) => {
        this.emit(event, ...args);
      };

      this.vm.on(event, baseListener);
    }

    return super.on(event, listener);
  }

  once<eventName extends keyof K8s.KubernetesBackendEvents>(event: eventName, listener: K8s.KubernetesBackendEvents[eventName]): this {
    if (!(event in this.eventForwarders)) {
      const baseListener = (...args: any[]) => {
        this.emit(event, ...args);
        // This leaves a dangling listener
      };

      this.vm.on(event, baseListener);
    }

    return super.on(event, listener);
  }

  removeListener<eventName extends keyof K8s.KubernetesBackendEvents>(event: eventName, listener: K8s.KubernetesBackendEvents[eventName]): this {
    super.removeListener(event, listener);
    const eventName = event as keyof BackendEvents;
    const baseListener = this.eventForwarders[eventName];

    if (this.listenerCount(event) < 1 && baseListener) {
      this.vm.removeListener(eventName, baseListener);
      delete this.eventForwarders[eventName];
    }

    return this;
  }

  off<eventName extends keyof K8s.KubernetesBackendEvents>(event: eventName, listener: K8s.KubernetesBackendEvents[eventName]): this {
    super.off(event, listener);
    const eventName = event as keyof BackendEvents;
    const baseListener = this.eventForwarders[eventName];

    if (this.listenerCount(event) < 1 && baseListener) {
      this.vm.off(eventName, baseListener);
      delete this.eventForwarders[eventName];
    }

    return this;
  }

  // #endregion

  eventNames(): Array<keyof K8s.KubernetesBackendEvents> {
    return super.eventNames() as Array<keyof K8s.KubernetesBackendEvents>;
  }

  listeners<eventName extends keyof K8s.KubernetesBackendEvents>(
    event: eventName,
  ): K8s.KubernetesBackendEvents[eventName][] {
    return super.listeners(event) as K8s.KubernetesBackendEvents[eventName][];
  }

  rawListeners<eventName extends keyof K8s.KubernetesBackendEvents>(
    event: eventName,
  ): K8s.KubernetesBackendEvents[eventName][] {
    return super.rawListeners(event) as K8s.KubernetesBackendEvents[eventName][];
  }
  // #endregion
}
