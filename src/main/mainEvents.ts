/**
 * This module is an EventEmitter for communication between various parts of the
 * main process.
 */

import { EventEmitter } from 'events';

import { VMBackend } from '@/backend/backend';
import { Settings } from '@/config/settings';
import { RecursivePartial } from '@/utils/typeUtils';

interface MainEventNames {
  /**
   * Emitted when the Kubernetes backend state has changed.
   */
   'k8s-check-state'(mgr: VMBackend): void;
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
   /**
    * Emitted after the network has been disconnected or connected.
    * @param online If true, then the network connection is (probably) working.
    */
   'update-network-status'(online: boolean): void;
   /**
    * Emitted when the integration state has changed.
    *
    * @param state A mapping of WSL distributions to the current state, or a
    * string if there is an error.
    */
   'integration-update'(state: Record<string, boolean|string>): void;

   /**
    * Emitted as a request to get the credentials for API access.
    */
   'api-get-credentials'(): void;
   /**
    * Emitted as a reply to 'api-get-credentials'; the credentials can be used
    * via HTTP basic auth on localhost.
    *
    * @note These credentials are meant for the UI; using them may require user
    * interaction.
    */
   'api-credentials'(credentials: {user: string, password: string, port: number}): void;
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
