// Kuberentes backend for Windows, based on WSL2 + k3s

import events from 'events';
import { Settings } from '../config/settings';
import * as K8s from './k8s';

export default class WSLBackend extends events.EventEmitter implements K8s.KubernetesBackend {
  constructor(cfg: Settings['kubernetes']) {
    super();
    this.cfg = cfg;
  }

  protected cfg: Settings['kubernetes'];

  /** The current user-visible state of the backend. */
  protected _state: K8s.State = K8s.State.STOPPED;
  get state() {
    return this._state;
  }

  get version(): string {
    throw new Error('property not implemented');
  }

  get cpus(): Promise<number> {
    return Promise.reject(new Error('property not implemented'));
  }

  get memory(): Promise<number> {
    return Promise.reject(new Error('property not implemented'));
  }

  start(): Promise<void> {
    return Promise.reject(new Error('Method not implemented.'));
  }

  stop(): Promise<number> {
    return Promise.reject(new Error('Method not implemented.'));
  }

  del(): Promise<number> {
    return Promise.reject(new Error('Method not implemented.'));
  }

  reset(): Promise<void> {
    return Promise.reject(new Error('Method not implemented.'));
  }

  factoryReset(): Promise<void> {
    return Promise.reject(new Error('Method not implemented.'));
  }

  listServices(namespace?: string): K8s.ServiceEntry[] {
    throw new Error('Method not implemented.');
  }

  requiresRestartReasons(): Promise<Record<string, [any, any] | []>> {
    return Promise.reject(new Error('Method not implemented.'));
  }

  forwardPort(namespace: string, service: string, port: number): Promise<number | null> {
    return Promise.reject(new Error('Method not implemented.'));
  }

  cancelForward(namespace: string, service: string, port: number): Promise<void> {
    return Promise.reject(new Error('Method not implemented.'));
  }
}
