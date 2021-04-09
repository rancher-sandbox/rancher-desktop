import events from 'events';
import os from 'os';
import { Settings } from '../config/settings';
import { ServiceEntry } from './client';
import { Minikube } from './minikube.js';
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

export interface KubernetesBackend extends events.EventEmitter {
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

  /** Start the Kubernetes cluster. */
  start(): Promise<void>;

  /** Stop the Kubernetes cluster, returning the exit code. */
  stop(): Promise<number>;

  /** Delete the Kubernetes cluster, returning the exit code. */
  del(): Promise<number>;

  /** Reset the Kubernetes cluster, removing all workloads. */
  reset(): Promise<void>;

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
   * Fetch the list of services currently known to Kubernetes.
   * @param namespace The namespace containing services; omit this to
   *                  return services across all namespaces.
   */
  listServices(namespace?: string): ServiceEntry[];

  /**
   * Forward a single service port, returning the resulting local port number.
   * @param namespace The namespace containing the service to forward.
   * @param service The name of the service to forward.
   * @param port The internal port number of the service to forward.
   * @returns The port listening on localhost that forwards to the service.
   */
  forwardPort(namespace: string, service: string, port: number): Promise<number | undefined>;

  /**
   * Cancel an existing port forwarding.
   * @param {string} namespace The namespace containing the service to forward.
   * @param {string} service The name of the service to forward.
   * @param {number} port The internal port number of the service to forward.
   */
  cancelForward(namespace: string, service: string, port: number): Promise<void>;

}

export function factory(cfg: Settings['kubernetes']): KubernetesBackend {
  switch (os.platform()) {
  case 'darwin':
    return new Minikube(cfg);
  case 'win32':
    return new WSLBackend(cfg);
  default:
    return new OSNotImplemented(cfg);
  }
}
