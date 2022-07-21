import events from 'events';

import { EventEmitter } from 'stream';
import semver from 'semver';

import { ServiceEntry } from './client';

import { Settings } from '@/config/settings';
import { RecursiveKeys, RecursivePartial, RecursiveReadonly } from '@/utils/typeUtils';

export { ServiceEntry } from './client';

export enum State {
  STOPPED = 0, // The engine is not running.
  STARTING, // The engine is attempting to start.
  STARTED, // The engine is started; the dashboard is not yet ready.
  STOPPING, // The engine is attempting to stop.
  ERROR, // There is an error and we cannot recover automatically.
  DISABLED, // The container backend is ready but the Kubernetes engine is disabled.
}

export class KubernetesError extends Error {
  constructor(name: string, message: string, fatal = false) {
    super(message);
    this.name = name;
    this.fatal = fatal;
  }

  readonly fatal: boolean;
}

export type KubernetesProgress = {
  /** The current progress; valid values are 0 to max. */
  current: number,
  /** Maximum progress possible; if less than zero, the progress is indeterminate. */
  max: number,
  /** Details on the current action. */
  description?: string,
  /** When we entered this progress state. */
  transitionTime?: Date,
}

export type Architecture = 'x86_64' | 'aarch64';

export type FailureDetails = {
  /** The last lima/wsl command run: */
  lastCommand?: string,
  lastCommandComment: string,
  lastLogLines: Array<string>,
}

/**
 * VersionEntry describes a version of K3s.
 */
export interface VersionEntry {
  /** The version being described. This includes any build-specific data. */
  version: semver.SemVer;
  /** A string describing the channels that include this version, if any. */
  channels?: string[];
}

/**
 * KubernetesBackendEvents describes the events that may be emitted by a
 * Kubernetes backend (as an EventEmitter).  Each property name is the name of
 * an event, and the property type is the type of the callback function expected
 * for the given event.
 */
interface KubernetesBackendEvents {
  /**
   * Emitted when there has been a change in the progress in the current action.
   * The progress can be read off the `progress` member on the backend.
   */
  'progress': () => void;

  /**
   * Emitted when the set of Kubernetes services has changed.
   */
  'service-changed': (services: ServiceEntry[]) => void;

  /**
   * Emitted when an error related to the port forwarding server has occurred.
   */
  'service-error': (service: ServiceEntry, errorMessage: string) => void;

  /**
   * Emitted when the state of the Kubernetes backend has changed.
   */
  'state-changed': (state: State) => void;

  /**
   * Emitted when the versions of Kubernetes available has changed.
   */
  'versions-updated': () => void;

  /**
   * Emitted when k8s is running on a new port
   */
  'current-port-changed': (port: number) => void;

  /**
   * Show a notification to the user.
   */
  'show-notification': (options: Electron.NotificationConstructorOptions) => void;

  /**
   * Emitted when the checkForExistingKimBuilder setting pref changes
   */
  'kim-builder-uninstalled': () => void;
}

/**
 * Settings that KubernetesBackend can access.
 */
export type BackendSettings = RecursiveReadonly<Settings['kubernetes']>;

/**
 * Reasons that the backend might need to restart, as returned from
 * `requiresRestartReasons()`.
 * @returns A mapping of the preference causing the restart to the changed
 *          values.
 */
export type RestartReasons = Partial<Record<RecursiveKeys<Settings>, {
  /**
   * The currently active value.
   */
  current: any;
  /**
   * The desired value (which must be different from the current value to
   * require a restart).
   */
  desired: any;
  /**
   * The severity of the restart; this may be set to `reset` for some values
   * indicating that there will be data loss.
   */
  severity: 'restart' | 'reset';
}>>;

export interface KubernetesBackend extends events.EventEmitter, KubernetesBackendPortForwarder {
  /** The name of the Kubernetes backend */
  readonly backend: 'wsl' | 'lima' | 'mock';

  state: State;

  /**
   * The versions that are available to install, sorted as would be displayed to
   * the user.
   */
  availableVersions: Promise<VersionEntry[]>;

  /**
   * Used to let the UI know whether it was sent all potentially supported k8s versions.
   * If this returns true, it means we're only telling the UI which versions we have cached.
   */
  cachedVersionsOnly(): Promise<boolean>;

  /** The version of Kubernetes that is currently installed. */
  version: string;

  /** The number of CPUs in the running VM, or 0 if the VM is not running. */
  cpus: Promise<number>;

  /** The amount of memory in the VM, in MiB, or 0 if the VM is not running. */
  memory: Promise<number>;

  /**
   * The port the Kubernetes server will listen on; this may not reflect the
   * port correctly if the server is not active.
   */
  readonly desiredPort: number;

  /** Progress for the current action. */
  progress: Readonly<KubernetesProgress>;

  /**
   * Whether debug mode is enabled. If this is set, the implementation should
   * emit extra debug logging if possible.
   */
  debug: boolean;

  /**
   * Check if the current backend is valid.
   * @returns Null if the backend is valid, otherwise an error describing why
   * the backend is invalid that can be shown to the user.
   */
  getBackendInvalidReason(): Promise<KubernetesError | null>;

  /**
   * Start the Kubernetes cluster.  If it is already started, it will be
   * restarted.
   */
  start(config: BackendSettings): Promise<void>;

  /** Stop the Kubernetes cluster.  If applicable, shut down the VM. */
  stop(): Promise<void>;

  /** Delete the Kubernetes cluster, returning the exit code. */
  del(): Promise<void>;

  /** Reset the Kubernetes cluster, removing all workloads. */
  reset(config: BackendSettings): Promise<void>;

  /**
   * Reset the cluster, completely deleting any user configuration.  This does
   * not automatically restart the cluster.
   */
  factoryReset(keepSystemImages: boolean): Promise<void>;

  /**
   * Check if applying the given settings would require the backend to restart.
   */
  requiresRestartReasons(config: RecursivePartial<BackendSettings>): Promise<RestartReasons>;

  /**
   * Get the external IP address where the services would be listening on, if
   * available.  For VM-based systems, this would be the address of the VM's
   * network interface.  This address may be undefined if the backend is
   * currently not in a state that supports services; for example, if the VM is
   * off.
   */
  readonly ipAddress: Promise<string | undefined>;

  /**
   * Fetch the list of services currently known to Kubernetes.
   * @param namespace The namespace containing services; omit this to
   *                  return services across all namespaces.
   */
  listServices(namespace?: string): ServiceEntry[];

  /**
   * Check if a given service is ready.
   * @param namespace The namespace in which to lookup the service.
   * @param service The name of the service to lookup.
   */
  isServiceReady(namespace: string, service: string): Promise<boolean>;

  /**
   * If called after a backend operation fails, this returns a block of data that attempts
   * to give more information about what command was being run when the error happened.
   *
   * @param [exception] The associated exception.
   */
  getFailureDetails(exception: any): Promise<FailureDetails>;

  /**
   * A description of the last backend command, usually displayed by the progress tracker,
   * but available for the `FailureDetails` block.
   */
  lastCommandComment: string;

  /**
   * If true, the backend cannot invoke any dialog boxes and needs to find an alternative.
   */
  noModalDialogs: boolean;

  // Override the EventEmitter methods to provide type information for
  // TypeScript so that we can get type checking for event names.  This ensures
  // that we do not accidentally listen for events that would never be emitted.
  // Please refer to EventEmitter for documentation on the individual methods.
  // #region Events
  addListener<eventName extends keyof KubernetesBackendEvents>(
    event: eventName,
    listener: KubernetesBackendEvents[eventName]
  ): this;
  on<eventName extends keyof KubernetesBackendEvents>(
    event: eventName,
    listener: KubernetesBackendEvents[eventName]
  ): this;
  once<eventName extends keyof KubernetesBackendEvents>(
    event: eventName,
    listener: KubernetesBackendEvents[eventName]
  ): this;
  removeListener<eventName extends keyof KubernetesBackendEvents>(
    event: eventName,
    listener: KubernetesBackendEvents[eventName]
  ): this;
  off<eventName extends keyof KubernetesBackendEvents>(
    event: eventName,
    listener: KubernetesBackendEvents[eventName]
  ): this;
  removeAllListeners<eventName extends keyof KubernetesBackendEvents>(event: eventName): this;
  listeners<eventName extends keyof KubernetesBackendEvents>(
    event: eventName
  ): ReturnType<EventEmitter['listeners']>;
  rawListeners<eventName extends keyof KubernetesBackendEvents>(
    event: eventName
  ): ReturnType<EventEmitter['rawListeners']>;
  emit<eventName extends keyof KubernetesBackendEvents>(
    event: eventName,
    ...args: globalThis.Parameters<KubernetesBackendEvents[eventName]>
  ): boolean;
  listenerCount<eventName extends keyof KubernetesBackendEvents>(event: eventName): number;
  prependListener<eventName extends keyof KubernetesBackendEvents>(
    event: eventName,
    listener: KubernetesBackendEvents[eventName]
  ): this;
  prependOnceListener<eventName extends keyof KubernetesBackendEvents>(
    event: eventName,
    listener: KubernetesBackendEvents[eventName]
  ): this;
  eventNames(): Array<string | symbol>;

  // #endregion

}

export interface KubernetesBackendPortForwarder {
  /**
   * Forward a single service port, returning the resulting local port number.
   * @param namespace The namespace containing the service to forward.
   * @param service The name of the service to forward.
   * @param k8sPort The internal port of the service to forward.
   * @param hostPort The host port to listen on for the forwarded port. Pass 0 for a random port.
   * @returns The port listening on localhost that forwards to the service.
   */
  forwardPort(namespace: string, service: string, k8sPort: number | string, hostPort: number): Promise<number | undefined>;

  /**
   * Cancel an existing port forwarding.
   * @param namespace The namespace containing the service to forward.
   * @param service The name of the service to forward.
   * @param k8sPort The internal port of the service to forward.
   * @param hostPort The host port to listen on for the forwarded port. Pass 0 for a random port.
   */
  cancelForward(namespace: string, service: string, k8sPort: number | string): Promise<void>;
}
