/**
 * This module is an EventEmitter for communication between various parts of the
 * main process.
 */

import { EventEmitter } from 'events';

import type { VMBackend } from '@/backend/backend';
import type { Settings } from '@/config/settings';
import { RecursivePartial } from '@/utils/typeUtils';

/**
 * MainEventNames describes the events available over the MainEvents event
 * emitter.  All normal events are described as methods returning void, with
 * the parameters of the event being the data that is send (and received).
 * For asynchronous RPC, we use a non-void return type; they can be used via
 * mainEvents.handle() and mainEvents.invoke(); see the description of those
 * methods for details.
 */
interface MainEventNames {
  /**
   * Emitted when the Kubernetes backend state has changed.
   */
  'k8s-check-state'(mgr: VMBackend): void;

  /**
   * Fetch the currently stored settings.
   * @note This may not match the currently active settings.
   */
  'settings-fetch'(): Settings;

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
  'cert-ca-certificates'(certs: (string | Buffer)[]): void;

  /**
   * Emitted after the network setup is complete.
   */
  'network-ready'(): void;

  /**
   * Emitted when the integration state has changed.
   *
   * @param state A mapping of WSL distributions to the current state, or a
   * string if there is an error.
   */
  'integration-update'(state: Record<string, boolean | string>): void;

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
  'api-credentials'(credentials: { user: string, password: string, port: number }): void;
}

/**
 * Helper type definition to check if the given event name is a handler (i.e.
 * has a return value) instead of an event (i.e. returns void).
 */
type IsHandler<eventName extends keyof MainEventNames> =
  // We check if void extends the return type; if the return type is also void,
  // then this check succeeds (they're equal); otherwise, it fails.
  void extends ReturnType<MainEventNames[eventName]> ? false : true;

/**
 * Parameter types for mainEvents.invoke(eventName, ...params)
 * Given the definition above, these only apply to methods on MainEventNames
 * that do not return void.
 */
type HandlerParams<eventName extends keyof MainEventNames> =
  IsHandler<eventName> extends true
  ? Parameters<MainEventNames[eventName]>
  : never;

/**
 * The return type for mainEvents.invoke(eventName, ...), without the Promise<>
 * wrapper.  Given the definition above, these only apply to methods on
 * MainEventNames that do not return void.
 */
type HandlerReturn<eventName extends keyof MainEventNames> =
  IsHandler<eventName> extends true
  ? ReturnType<MainEventNames[eventName]>
  : never;

/**
 * The complete type for a handler, combining both the parameters and the
 * return type.
 */
type HandlerType<eventName extends keyof MainEventNames> =
  IsHandler<eventName> extends true
  ? (...args: HandlerParams<eventName>) => Promise<HandlerReturn<eventName>>
  : never;

interface MainEvents extends EventEmitter {
  emit<eventName extends keyof MainEventNames>(
    event: IsHandler<eventName> extends false ? eventName : never,
    ...args: Parameters<MainEventNames[eventName]>
  ): boolean;
  /** @deprecated */ // Via eslint deprecation/deprecation: prevent usage of unrecognized events.
  emit(eventName: string | symbol, ...args: any[]): boolean;
  on<eventName extends keyof MainEventNames>(
    event: IsHandler<eventName> extends false ? eventName : never,
    listener: (...args: Parameters<MainEventNames[eventName]>) => void
  ): this;
  /** @deprecated */ // Via eslint deprecation/deprecation: prevent usage of unrecognized events.
  on(event: string | symbol, listener: (...args: any[]) => void): this;

  /**
   * Invoke a handler that returns a promise of a result.
   */
  invoke<eventName extends keyof MainEventNames>(
    event: IsHandler<eventName> extends true ? eventName : never,
    ...args: HandlerParams<eventName>): Promise<HandlerReturn<eventName>>;

  /**
   * Register a handler that will handle invoke() callers.
   */
  handle<eventName extends keyof MainEventNames>(
    event: IsHandler<eventName> extends true ? eventName : never,
    handler: HandlerType<eventName>
  ): void;
}

class MainEventsImpl extends EventEmitter implements MainEvents {
  handlers: {
    [eventName in keyof MainEventNames]?: HandlerType<eventName> | undefined;
  } = {};

  async invoke<eventName extends keyof MainEventNames>(
    event: IsHandler<eventName> extends true ? eventName : never,
    ...args: HandlerParams<eventName>
  ): Promise<HandlerReturn<eventName>> {
    const handler: HandlerType<eventName> | undefined = this.handlers[event] as any;

    if (handler) {
      return await handler(...args);
    }
    throw new Error(`No handlers registered for mainEvents::${ event }`);
  }

  handle<eventName extends keyof MainEventNames>(
    event: IsHandler<eventName> extends true ? eventName : never,
    handler: HandlerType<eventName>,
  ): void {
    this.handlers[event] = handler as any;
  }
}
const mainEvents: MainEvents = new MainEventsImpl();

export default mainEvents;
