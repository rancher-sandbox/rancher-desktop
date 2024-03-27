import events from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import timers from 'timers';
import util from 'util';

import semver from 'semver';
import yaml from 'yaml';

import { Architecture, BackendSettings, RestartReasons } from '../backend';
import BackendHelper from '../backendHelper';
import K3sHelper, { ExtraRequiresReasons, NoCachedK3sVersionsError, ShortVersion } from '../k3sHelper';
import LimaBackend, { Action } from '../lima';

import INSTALL_K3S_SCRIPT from '@pkg/assets/scripts/install-k3s';
import LOGROTATE_K3S_SCRIPT from '@pkg/assets/scripts/logrotate-k3s';
import SERVICE_CRI_DOCKERD_SCRIPT from '@pkg/assets/scripts/service-cri-dockerd.initd';
import SERVICE_K3S_SCRIPT from '@pkg/assets/scripts/service-k3s.initd';
import * as K8s from '@pkg/backend/k8s';
import { KubeClient } from '@pkg/backend/kube/client';
import { ContainerEngine } from '@pkg/config/settings';
import mainEvents from '@pkg/main/mainEvents';
import { checkConnectivity } from '@pkg/main/networking';
import clone from '@pkg/utils/clone';
import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';
import { RecursivePartial } from '@pkg/utils/typeUtils';
import { showMessageBox } from '@pkg/window';

const console = Logging.kube;

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
      await this.installK3s(desiredVersion);
      await this.writeServiceScript(config, desiredVersion, allowSudo);
      await BackendHelper.configureRuntimeClasses(this.vm);
    });

    this.activeVersion = desiredVersion;
  }

  /**
   * Start Kubernetes.
   * @returns The Kubernetes endpoint
   */
  async start(config_: BackendSettings, kubernetesVersion: semver.SemVer, kubeClient?: () => KubeClient): Promise<string> {
    const config = this.cfg = clone(config_);
    let k3sEndpoint = '';

    // Remove flannel config if necessary, before starting k3s
    if (!config.kubernetes.options.flannel) {
      await this.vm.execCommand({ root: true }, 'rm', '-f', '/etc/cni/net.d/10-flannel.conflist');
    }

    await this.progressTracker.action('Starting k3s', 100, async() => {
      // Run rc-update as we have dynamic dependencies.
      await this.vm.execCommand({ root: true }, '/sbin/rc-update', '--update');
      await this.vm.execCommand({ root: true }, '/sbin/rc-service', '--ifnotstarted', 'k3s', 'start');
    });

    await this.progressTracker.action(
      'Waiting for Kubernetes API',
      100,
      async() => {
        await this.k3sHelper.waitForServerReady(() => Promise.resolve('127.0.0.1'), config.kubernetes.port);
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

    this.client = kubeClient?.() || new KubeClient();

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
    this.currentPort = config.kubernetes.port;
    this.emit('current-port-changed', this.currentPort);

    // Remove traefik if necessary.
    if (!this.cfg?.kubernetes?.options.traefik) {
      await this.progressTracker.action(
        'Removing Traefik',
        50,
        this.k3sHelper.uninstallTraefik(this.client));
    }

    await this.k3sHelper.getCompatibleKubectlVersion(this.activeVersion);
    if (this.cfg?.kubernetes?.options.flannel) {
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

    return k3sEndpoint;
  }

  async stop() {
    if (this.cfg?.kubernetes?.enabled) {
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
  readonly k3sHelper: K3sHelper;

  protected client: KubeClient | null = null;

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
    return this.cfg?.kubernetes?.port ?? 6443;
  }

  protected get desiredVersion(): Promise<semver.SemVer> {
    return (async() => {
      const availableVersions = (await this.k3sHelper.availableVersions).map(v => v.version);

      return await BackendHelper.getDesiredVersion(this.cfg as BackendSettings, availableVersions, this.vm.noModalDialogs, this.vm.writeSetting.bind(this.vm));
    })();
  }

  /**
   * Install K3s into the VM for execution.
   * @param version The version to install.
   */
  protected async installK3s(version: semver.SemVer) {
    const k3s = this.arch === 'aarch64' ? 'k3s-arm64' : 'k3s';

    await this.vm.execCommand('mkdir', '-p', 'bin');
    await this.vm.writeFile('bin/install-k3s', INSTALL_K3S_SCRIPT, 'a+x');
    await fs.promises.chmod(path.join(paths.cache, 'k3s', version.raw, k3s), 0o755);
    await this.vm.execCommand({ root: true }, 'bin/install-k3s', version.raw, path.join(paths.cache, 'k3s'));
  }

  /**
   * Write the openrc script for k3s.
   */
  protected async writeServiceScript(cfg: BackendSettings, desiredVersion: semver.SemVer, allowSudo: boolean) {
    const config: Record<string, string> = {
      PORT:            this.desiredPort.toString(),
      ENGINE:          cfg.containerEngine.name ?? ContainerEngine.NONE,
      ADDITIONAL_ARGS: `--node-ip ${ await this.vm.ipAddress }`,
      LOG_DIR:         paths.logs,
      USE_CRI_DOCKERD: BackendHelper.requiresCRIDockerd(cfg.containerEngine.name, desiredVersion.version).toString(),
    };

    if (os.platform() === 'darwin') {
      if (cfg.kubernetes.options.flannel) {
        const { iface, addr } = await this.vm.getListeningInterface(allowSudo);

        config.ADDITIONAL_ARGS += ` --flannel-iface ${ iface }`;
        if (addr) {
          config.ADDITIONAL_ARGS += ` --node-external-ip ${ addr }`;
        }
      } else {
        console.log(`Disabling flannel and network policy`);
        config.ADDITIONAL_ARGS += ' --flannel-backend=none --disable-network-policy';
      }
    }
    if (!cfg.kubernetes.options.traefik) {
      config.ADDITIONAL_ARGS += ' --disable traefik';
    }
    await this.vm.writeFile('/etc/init.d/cri-dockerd', SERVICE_CRI_DOCKERD_SCRIPT, 0o755);
    await this.vm.writeConf('cri-dockerd', {
      LOG_DIR: paths.logs,
      ENGINE:  cfg.containerEngine.name ?? ContainerEngine.NONE,
    });
    await this.vm.writeFile('/etc/init.d/k3s', SERVICE_K3S_SCRIPT, 0o755);
    await this.vm.writeConf('k3s', config);
    await this.vm.writeFile('/etc/logrotate.d/k3s', LOGROTATE_K3S_SCRIPT);
  }

  async deleteIncompatibleData(desiredVersion: semver.SemVer) {
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
        'kubernetes.version': (current: string, desired: string) => {
          if (semver.gt(current || '0.0.0', desired)) {
            return 'reset';
          }

          return 'restart';
        },
        'application.adminAccess':                          undefined,
        'containerEngine.allowedImages.enabled':            undefined,
        'containerEngine.name':                             undefined,
        'experimental.containerEngine.webAssembly.enabled': undefined,
        'kubernetes.port':                                  undefined,
        'kubernetes.enabled':                               undefined,
        'kubernetes.options.traefik':                       undefined,
        'kubernetes.options.flannel':                       undefined,
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
