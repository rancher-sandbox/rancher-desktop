import events from 'events';
import path from 'path';
import timers from 'timers';
import util from 'util';

import semver from 'semver';

import { KubeClient } from './client';
import K3sHelper, { ExtraRequiresReasons, NoCachedK3sVersionsError, ShortVersion } from '../k3sHelper';
import WSLBackend, { Action } from '../wsl';

import INSTALL_K3S_SCRIPT from '@pkg/assets/scripts/install-k3s';
import { BackendSettings, RestartReasons } from '@pkg/backend/backend';
import BackendHelper, { MANIFEST_CERT_MANAGER, MANIFEST_SPIN_OPERATOR } from '@pkg/backend/backendHelper';
import * as K8s from '@pkg/backend/k8s';
import { LockedFieldError } from '@pkg/config/commandLineOptions';
import { ContainerEngine } from '@pkg/config/settings';
import mainEvents from '@pkg/main/mainEvents';
import { checkConnectivity } from '@pkg/main/networking';
import { SemanticVersionEntry } from '@pkg/utils/kubeVersions';
import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';
import { RecursivePartial } from '@pkg/utils/typeUtils';
import { showMessageBox } from '@pkg/window';

const console = Logging.kube;

export default class WSLKubernetesBackend extends events.EventEmitter implements K8s.KubernetesBackend {
  constructor(vm: WSLBackend) {
    super();
    this.vm = vm;

    this.k3sHelper.on('versions-updated', () => this.emit('versions-updated'));
    this.k3sHelper.initialize().catch((err) => {
      console.log('k3sHelper.initialize failed: ', err);
      // If we fail to initialize, we still need to continue (with no versions).
      this.emit('versions-updated');
    });
    mainEvents.on('network-ready', () => this.k3sHelper.networkReady());
  }

  protected cfg: BackendSettings | undefined;
  protected vm: WSLBackend;
  /** Helper object to manage available K3s versions. */
  readonly k3sHelper = new K3sHelper('x86_64');
  protected client: KubeClient | null = null;

  /** The version of Kubernetes currently running. */
  protected activeVersion: semver.SemVer | undefined;

  /** The port the Kubernetes server is listening on (default 6443) */
  protected currentPort = 0;

  get progressTracker() {
    return this.vm.progressTracker;
  }

  protected get downloadURL() {
    return 'https://github.com/k3s-io/k3s/releases/download';
  }

  get version(): ShortVersion {
    return this.activeVersion?.version ?? '';
  }

  get port(): number {
    return this.currentPort;
  }

  get availableVersions(): Promise<SemanticVersionEntry[]> {
    return this.k3sHelper.availableVersions;
  }

  async cachedVersionsOnly(): Promise<boolean> {
    return await K3sHelper.cachedVersionsOnly();
  }

  protected get desiredVersion(): Promise<semver.SemVer | undefined> {
    return (async() => {
      let availableVersions: SemanticVersionEntry[];
      let available = true;

      try {
        availableVersions = await this.k3sHelper.availableVersions;

        return await BackendHelper.getDesiredVersion(
          this.cfg as BackendSettings,
          availableVersions,
          this.vm.noModalDialogs,
          this.vm.writeSetting.bind(this.vm));
      } catch (ex) {
        // Locked field errors are fatal and will quit the application
        if (ex instanceof LockedFieldError) {
          throw ex;
        }
        console.error(`Could not get desired version: ${ ex }`);
        available = false;

        return undefined;
      } finally {
        mainEvents.emit('diagnostics-event', { id: 'kube-versions-available', available });
      }
    })();
  }

  async deleteIncompatibleData(desiredVersion: semver.SemVer) {
    const existingVersion = await K3sHelper.getInstalledK3sVersion(this.vm);

    if (!existingVersion) {
      return;
    }
    if (semver.gt(existingVersion, desiredVersion)) {
      console.log(`Deleting incompatible Kubernetes state due to downgrade from ${ existingVersion } to ${ desiredVersion }...`);
      await this.vm.progressTracker.action(
        'Deleting incompatible Kubernetes state',
        100,
        this.k3sHelper.deleteKubeState(this.vm));
    }
  }

  get desiredPort() {
    return this.cfg?.kubernetes?.port ?? 6443;
  }

  /**
   * Download K3s images.  This will also calculate the version to download.
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
      const desiredVersion = await this.desiredVersion;

      if (desiredVersion === undefined) {
        return [undefined, false];
      }

      try {
        await this.progressTracker.action('Checking k3s images', 100, this.k3sHelper.ensureK3sImages(desiredVersion));

        return [desiredVersion, false];
      } catch (ex) {
        if (!await checkConnectivity('github.com')) {
          throw ex;
        }

        try {
          const newVersion = await K3sHelper.selectClosestImage(desiredVersion);
          const isDowngrade = semver.lt(newVersion, desiredVersion);

          if (isDowngrade) {
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
              return [undefined, true];
            }
          }
          console.log(`Going with alternative version ${ newVersion.raw }`);

          return [newVersion, isDowngrade];
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

  async install(config: BackendSettings, version: semver.SemVer, allowSudo: boolean) {
    await this.vm.runInstallScript(INSTALL_K3S_SCRIPT,
      'install-k3s', version.raw, await this.vm.wslify(path.join(paths.cache, 'k3s')));

    if (config.experimental?.containerEngine?.webAssembly?.enabled) {
      const promises: Promise<void>[] = [];

      promises.push(BackendHelper.configureRuntimeClasses(this.vm));
      if (config.experimental?.kubernetes?.options?.spinkube) {
        promises.push(BackendHelper.configureSpinOperator(this.vm));
      }
      await Promise.all(promises);
    }
  }

  async start(config: BackendSettings, activeVersion: semver.SemVer, kubeClient?: () => KubeClient): Promise<void> {
    if (!config) {
      throw new Error('no config!');
    }
    this.cfg = config;

    // Clean up kubernetes cgroups before we start, as Kubernetes 1.31.0+ fails
    // to start if these are left over.  We need to remove all cgroups named
    // "kubepods" as well as their descendants (which are expected to all be
    // empty).
    await this.progressTracker.action('Removing stale state', 50,
      this.vm.execCommand('busybox', 'find', '/sys/fs/cgroup', '-name', 'kubepods', '-exec',
        'busybox', 'find', '{}', '-type', 'd', '-delete', ';', '-prune'));

    const executable = config.containerEngine.name === ContainerEngine.MOBY ? 'docker' : 'nerdctl';

    await this.vm.verifyReady(executable, 'images');

    // Remove flannel config if necessary, before starting k3s
    if (!config.kubernetes.options.flannel) {
      await this.vm.execCommand('busybox', 'rm', '-f', '/etc/cni/net.d/10-flannel.conflist');
    }
    await this.progressTracker.action('Starting k3s', 100, this.vm.startService('k3s'));

    if (this.vm.currentAction !== Action.STARTING) {
      // User aborted
      return;
    }

    await this.progressTracker.action(
      'Waiting for Kubernetes API',
      100,
      this.k3sHelper.waitForServerReady(() => this.vm.ipAddress, config.kubernetes?.port));
    await this.progressTracker.action(
      'Updating kubeconfig',
      100,
      async() => {
        // Wait for the file to exist first, for slow machines.
        const command = 'if test -r /etc/rancher/k3s/k3s.yaml; then echo yes; else echo no; fi';

        while (true) {
          const result = await this.vm.execCommand({ capture: true }, '/bin/sh', '-c', command);

          if (result.includes('yes')) {
            break;
          }
          await util.promisify(timers.setTimeout)(1_000);
        }

        await this.k3sHelper.updateKubeconfig(
          async() => await this.vm.execCommand({ capture: true }, await this.vm.getWSLHelperPath(), 'k3s', 'kubeconfig'));
      });

    const client = this.client = kubeClient?.() || new KubeClient();

    await this.progressTracker.action(
      'Waiting for services',
      50,
      async() => {
        await client.waitForServiceWatcher();
        client.on('service-changed', (services) => {
          this.emit('service-changed', services);
        });
        client.on('service-error', (service, errorMessage) => {
          this.emit('service-error', service, errorMessage);
        });
      });

    this.activeVersion = activeVersion;
    this.currentPort = config.kubernetes.port;
    this.emit('current-port-changed', this.currentPort);

    // Remove traefik if necessary.
    if (!config.kubernetes.options.traefik) {
      await this.progressTracker.action(
        'Removing Traefik',
        50,
        this.k3sHelper.uninstallHelmChart(client, 'traefik'));
    }
    if (!this.cfg?.experimental?.kubernetes?.options?.spinkube) {
      await this.progressTracker.action(
        'Removing spinkube operator',
        50,
        Promise.all([
          this.k3sHelper.uninstallHelmChart(this.client, MANIFEST_CERT_MANAGER),
          this.k3sHelper.uninstallHelmChart(this.client, MANIFEST_SPIN_OPERATOR),
        ]));
    }

    await this.k3sHelper.getCompatibleKubectlVersion(this.activeVersion as semver.SemVer);
    if (config.kubernetes.options.flannel) {
      await this.progressTracker.action(
        'Waiting for nodes',
        100,
        client.waitForReadyNodes());
    } else {
      await this.progressTracker.action(
        'Skipping node checks, flannel is disabled',
        100, Promise.resolve({}));
    }
  }

  async stop() {
    await this.cleanup();
    // No need to actually stop the service; the whole distro will shut down.
  }

  cleanup() {
    this.client?.destroy();

    return Promise.resolve();
  }

  async reset() {
    await this.k3sHelper.deleteKubeState(this.vm);
  }

  requiresRestartReasons(oldConfig: BackendSettings, newConfig: RecursivePartial<BackendSettings>, extras: ExtraRequiresReasons = {}): Promise<RestartReasons> {
    return Promise.resolve(this.k3sHelper.requiresRestartReasons(
      oldConfig,
      newConfig,
      {
        'kubernetes.version': (current: string, desired: string) => {
          if (semver.gt(current || '0.0.0', desired)) {
            return 'reset';
          }

          return 'restart';
        },
        'containerEngine.allowedImages.enabled':            undefined,
        'containerEngine.name':                             undefined,
        'experimental.containerEngine.webAssembly.enabled': undefined,
        'experimental.kubernetes.options.spinkube':         undefined,
        'kubernetes.enabled':                               undefined,
        'kubernetes.ingress.localhostOnly':                 undefined,
        'kubernetes.options.flannel':                       undefined,
        'kubernetes.options.traefik':                       undefined,
        'kubernetes.port':                                  undefined,
        'WSL.integrations':                                 undefined,
      },
      extras,
    ));
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
