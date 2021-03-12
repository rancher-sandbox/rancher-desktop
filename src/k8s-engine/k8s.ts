import events from 'events';
import os from 'os';
import { Settings } from '../config/settings';
import { Minikube } from './minikube.js';
import { OSNotImplemented } from './notimplemented.js';
export { KubeClient as Client } from './client';

export enum State {
  STOPPED = 0, // The engine is not running.
  STARTING, // The engine is attempting to start.
  STARTED, // The engine is started; the dashboard is not yet ready.
  STOPPING, // The engine is attempting to stop.
  ERROR, // There is an error and we cannot recover automatically.
}

export interface KubernetesBackend extends events.EventEmitter {
  state: State;

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
   * Fetch the list of services currently known to Kubernetes.
   * @param namespace The namespace containing services; omit this to
   *                  return services across all namespaces.
   */
  listServices(namespace?: string): any[];

  /**
   * Forward a single service port, returning the resulting local port number.
   * @param namespace The namespace containing the service to forward.
   * @param service The name of the service to forward.
   * @param port The internal port number of the service to forward.
   * @returns The port listening on localhost that forwards to the service.
   */
  forwardPort(namespace: string, service: string, port: number): Promise<number | null>;

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
  default:
    return new OSNotImplemented(cfg);
  }
}
