/**
 * This module is an EventEmitter for communication between various parts of the
 * main process.
 */

import { EventEmitter } from 'events';

import { Settings } from '@/config/settings';
import * as K8s from '@/k8s-engine/k8s';

interface MainEvents extends EventEmitter {
  /**
   * Emitted when the Kubernetes backend state has changed.
   */
  on(event: 'k8s-check-state', listener: (mgr: K8s.KubernetesBackend) => void): this;
  /**
   * Emitted when the settings have been changed.  The new settings are given.
   */
  on(event: 'settings-update', listener: (settings: Settings) => void): this;
  /* @deprecated */
  on(event: string | symbol, listener: (...args: any[]) => void): this;
}
class MainEventsImpl extends EventEmitter implements MainEvents { }
const mainEvents: MainEvents = new MainEventsImpl();

export default mainEvents;
