/**
 * This module is an EventEmitter for communication between various parts of the
 * main process.
 */

import { EventEmitter } from 'events';

import { Settings } from '@/config/settings';
import * as K8s from '@/k8s-engine/k8s';
import { RecursivePartial } from '@/utils/typeUtils';

interface MainEventNames {
  /**
   * Emitted when the Kubernetes backend state has changed.
   */
   'k8s-check-state'(mgr: K8s.KubernetesBackend): void;
   /**
    * Emitted when the settings have been changed.
    *
    * @param settings The new settings.
    */
   'settings-update'(settings: Settings): void;
   /**
    * Emitted to request that the settings be changed.
    *
    * @param settings The settings to change.
    */
   'settings-write'(settings: RecursivePartial<Settings>): void;
   /**
    * Emitted as a request to get the CA certificates.
    */
   'cert-get-ca-certificates'(): void;
   /**
    * Emitted as a reply to 'cert-get-ca-certificates'.
    *
    * @param certs The certificates found.
    */
   'cert-ca-certificates'(certs: (string|Buffer)[]): void;
   /**
    * Emitted after the network setup is complete.
    */
   'network-ready'() : void;
}

interface MainEvents extends EventEmitter {
  emit<eventName extends keyof MainEventNames>(
    event: eventName,
    ...args: Parameters<MainEventNames[eventName]>
  ): boolean;
  /* @deprecated */
  emit(eventName: string | symbol, ...args: any[]): boolean;
  on<eventName extends keyof MainEventNames>(
    event: eventName,
    listener: (...args: Parameters<MainEventNames[eventName]>) => void
  ): this;
  /* @deprecated */
  on(event: string | symbol, listener: (...args: any[]) => void): this;
}
class MainEventsImpl extends EventEmitter implements MainEvents { }
const mainEvents: MainEvents = new MainEventsImpl();

export default mainEvents;
