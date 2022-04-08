/**
 * This module is an EventEmitter for communication between various parts of the
 * main process.
 */

import { EventEmitter } from 'events';

import { Settings } from '@/config/settings';
import * as K8s from '@/k8s-engine/k8s';
import { RecursivePartial } from '@/utils/typeUtils';

interface MainEvents extends EventEmitter {
  /**
   * Emitted when the Kubernetes backend state has changed.
   */
  on(event: 'k8s-check-state', listener: (mgr: K8s.KubernetesBackend) => void): this;
  /**
   * Emitted when the settings have been changed.  The new settings are given.
   */
  on(event: 'settings-update', listener: (settings: Settings) => void): this;
  /**
   * Emitted to request that the settings be changed.
   */
  on(event: 'settings-write', listener: (settings: RecursivePartial<Settings>) => void): this;
  /**
   * Emitted as a request to get the CA certificates.
   */
  on(event: 'cert-get-ca-certificates', listener: () => void): this;
  /**
   * Emitted as a reply to 'cert-get-ca-certificates', with the list of CA
   * certificates.
   */
  on(event: 'cert-ca-certificates', listener:(certs: (string|Buffer)[]) => void): this;
  /**
   * Emitted after the network setup is complete.
   */
  on(event: 'network-ready', listener: () => void): this;
  /* @deprecated */
  on(event: string | symbol, listener: (...args: any[]) => void): this;
}
class MainEventsImpl extends EventEmitter implements MainEvents { }
const mainEvents: MainEvents = new MainEventsImpl();

export default mainEvents;
