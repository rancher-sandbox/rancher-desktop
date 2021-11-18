import events from 'events';
import os from 'os';
import { Settings } from '../config/settings';
import { ServiceEntry } from './client';
import LimaBackend from './lima';
import { OSNotImplemented } from './notimplemented.js';
import WSLBackend from './wsl';

export { KubeClient as Client, ServiceEntry } from './client';

export enum State {
  STOPPED = 0, // The engine is not running.
  STARTING, // The engine is attempting to start.
  STARTED, // The engine is started; the dashboard is not yet ready.
  STOPPING, // The engine is attempting to stop.
  ERROR, // There is an error and we cannot recover automatically.
}

export class KubernetesError extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
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

export interface KubernetesBackend extends events.EventEmitter {
  /** The name of the Kubernetes backend */
  readonly backend: 'wsl' | 'lima' | 'not-implemented';

  state: State;

  /**
   * The versions that are available to install.  The strings are in the form
   * of `v1.2.3`.
   */
  availableVersions: Promise<string[]>;

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
   * Check if the current backend is valid.
   * @returns Null if the backend is valid, otherwise an error describing why
   * the backend is invalid that can be shown to the user.
   */
  getBackendInvalidReason(): Promise<KubernetesError | null>;

  /**
   * Start the Kubernetes cluster.  If it is already started, it will be
   * restarted.
   */
  start(config: Settings['kubernetes']): Promise<void>;

  /** Stop the Kubernetes cluster.  If applicable, shut down the VM. */
  stop(): Promise<void>;

  /** Delete the Kubernetes cluster, returning the exit code. */
  del(): Promise<void>;

  /** Reset the Kubernetes cluster, removing all workloads. */
  reset(config: Settings['kubernetes']): Promise<void>;

  /**
   * Reset the cluster, completely deleting any user configuration.  This does
   * not automatically restart the cluster.
   */
  factoryReset(): Promise<void>;

  /**
   * For all possible reasons that the cluster might need to restart, return
   * either a tuple of (existing value, desired value) if a restart is needed
   * because of that reason, or an empty tuple.
   * @returns Reasons to restart; values are tuple of (existing value, desired value).
   */
  requiresRestartReasons(): Promise<Record<string, [any, any] | []>>;

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
   * Helper to handle port forwarding for this backend.  This may be null, in
   * which case port forwarding isn't supported.
   */
  readonly portForwarder: KubernetesBackendPortForwarder | null;

  /**
   * Return a list of possible integration points.
   *
   * @returns The integrations possible.  The value may be:
   *          true:     The integration is set.
   *          false:    The integration is not set, and may be changed.
   *          [string]: The integration is not available, for this reason.
   */
  listIntegrations(): Promise<Record<string, boolean | string>>;

  /**
   * Manages a list of warnings related to each supported integration point.
   *
   * Changes are asynchronously sent to the renderer, so this method doesn't need to return anything
   */
  listIntegrationWarnings(): void;

  /**
   * Enable or disable an integration.  This should not be called if the
   * integration is not in the expected state.
   *
   * @param name The integration to toggle.
   * @param state The new integration state.
   * @returns Any errors attempting to set the integration.
   */
  setIntegration(name: string, state: boolean): Promise<string | undefined>;

  // #region Events

  /**
   * Emitted when there has been a change in the progress in the current action.
   */
  on(event: 'progress', listener: (progress: { current: number, max: number }) => void): this;

  /**
   * Emitted when the set of Kubernetes services has changed.
   */
  on(event: 'service-changed', listener: (services: ServiceEntry[]) => void): this;

  /**
   * Emitted when the state of the Kubernetes backend has changed.
   */
  on(event: 'state-changed', listener: (state: State) => void): this;

  /**
   * Emitted when the versions of Kubernetes available has changed.
   */
  on(event: 'versions-updated', listener: () => void): this;

  /**
   * Emitted when k8s is running on a new port
   */
  on(event: 'current-port-changed', listener: (port: number) => void): this;

  // #endregion

}

export interface KubernetesBackendPortForwarder {
  /**
   * Forward a single service port, returning the resulting local port number.
   * @param namespace The namespace containing the service to forward.
   * @param service The name of the service to forward.
   * @param port The internal port of the service to forward.
   * @returns The port listening on localhost that forwards to the service.
   */
  forwardPort(namespace: string, service: string, port: number | string): Promise<number | undefined>;

  /**
   * Cancel an existing port forwarding.
   * @param namespace The namespace containing the service to forward.
   * @param service The name of the service to forward.
   * @param port The internal port of the service to forward.
   */
  cancelForward(namespace: string, service: string, port: number | string): Promise<void>;
}

export function factory(): KubernetesBackend {
  switch (os.platform()) {
  case 'linux':
    return new LimaBackend();
  case 'darwin':
    return new LimaBackend();
  case 'win32':
    return new WSLBackend();
  default:
    return new OSNotImplemented();
  }
}
