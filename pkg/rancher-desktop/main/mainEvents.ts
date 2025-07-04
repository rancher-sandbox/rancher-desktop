/**
 * This module is an EventEmitter for communication between various parts of the
 * main process.
 */

import { EventEmitter } from 'events';

import type { VMBackend } from '@pkg/backend/backend';
import type { Settings } from '@pkg/config/settings';
import type { TransientSettings } from '@pkg/config/transientSettings';
import { DiagnosticsCheckerResult } from '@pkg/main/diagnostics/types';
import { RecursivePartial, RecursiveReadonly } from '@pkg/utils/typeUtils';

export class NoMainEventsHandlerError extends Error {
  constructor(eventName: string) {
    super(`No handlers registered for mainEvents::${ eventName }`);
  }
}

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
  'settings-write'(settings: RecursivePartial<RecursiveReadonly<Settings>>): void;

  /**
   * Read the current transient settings.
   */
  'transient-settings-fetch'(): TransientSettings;

   /**
    * Emitted to update current transient settings.
    *
    * @param transientSettings The new transient settings.
    */
  'transient-settings-update'(transientSettings: RecursivePartial<TransientSettings>): void;

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
   * Emitted when the network comes online or goes offline.
   * @param connected The new network state.
   */
  'update-network-status'(connected: boolean): void;

  /**
   * Emitted when the integration state has changed.
   *
   * @param state A mapping of WSL distributions to the current state, or a
   * string if there is an error.
   */
  'integration-update'(state: Record<string, boolean | string>): void;

  /**
   * Fetch the API credentials that can be used for HTTP basic auth on localhost
   * to talk to the backend.
   *
   * @note These credentials are meant for the UI; using them may require user
   * interaction.
   */
  'api-get-credentials'(): { user: string, password: string, port: number };

  /**
   * Force trigger diagnostics with the given id.
   * This is used when something has changed that might affect whether the given
   * diagnostic needs to be re-run.
   * @note This does not update the last run time (since it only runs a single
   * checker).
   */
  'diagnostics-trigger'(id: string): DiagnosticsCheckerResult|DiagnosticsCheckerResult[] | undefined;

  /**
   * Generically signify that a diagnostic should be updated.
   * @param id The diagnostic identifier.
   * @param state The new state for the diagnostic.
   */
  'diagnostics-event'(payload: DiagnosticsEventPayload): void;

  /**
   * Emitted when an extension is uninstalled via the extension manager.
   * @param id The ID of the extension that was uninstalled.
   */
  'extensions/ui/uninstall'(id: string): void;

  /**
   * Emitted on application quit; this is used to shut down extensions.
   */
  'extensions/shutdown'(): Promise<void>;

  /**
   * Register the extension protocol handler in the given webContents partition.
   * @param partition The partition name; likely "persist:rdx-..."
   */
  'extensions/register-protocol'(partition: string): Promise<void>;

  /**
   * Emitted on application quit, used to shut down any integrations.  This
   * requires feedback from the handler to know when all tasks are complete.
   */
  'shutdown-integrations'(): Promise<void>;

  /**
   * Emitted on application quit.  Note that at this point we're committed to
   * quitting.
   */
  'quit'(): void;

  /**
   * Emitted when the state of the backend lock changes. An empty string indicates
   * a locked state, and a nonempty string indicates a locked state and serves as
   * an explanation as to why Rancher Desktop is in this state. It disables the UI,
   * prevents the user from making changes to settings, and possibly prevents other
   * actions that could cause problems with snapshot operations (as of the time of
   * writing snapshots is the sole use for this).
   */
  'backend-locked-update'(backendIsLocked: string, action?: string): void;

  /**
   * Emitted when a component wants to check the state of the backend lock.
   * Responds by emitting a backend-locked-update.
   */
  'backend-locked-check'(): void;

  'dialog-info'(args: Record<string, string>): void;
}

/**
 * DiagnosticsEventPayload defines the data that will be passed on a
 * 'diagnostics-event' event.
 */
type DiagnosticsEventPayload =
  { id: 'integrations-windows', distro?: string, key: string, error?: Error } |
  { id: 'kube-versions-available', available: boolean } |
  { id: 'path-management', fileName: string; error: Error | undefined };

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
  ? Awaited<ReturnType<MainEventNames[eventName]>>
  : never;

/**
 * The complete type for a handler, combining both the parameters and the
 * return type.
 */
type HandlerType<eventName extends keyof MainEventNames> =
  IsHandler<eventName> extends true
  ? (...args: HandlerParams<eventName>) => Promise<HandlerReturn<eventName>>
  : never;

export interface MainEvents extends EventEmitter {
  emit<eventName extends keyof MainEventNames>(
    event: IsHandler<eventName> extends false ? eventName : never,
    ...args: Parameters<MainEventNames[eventName]>
  ): boolean;

  on<eventName extends keyof MainEventNames>(
    event: IsHandler<eventName> extends false ? eventName : never,
    listener: (...args: Parameters<MainEventNames[eventName]>) => void
  ): this;
  once<eventName extends keyof MainEventNames>(
    event: IsHandler<eventName> extends false ? eventName : never,
    listener: (...args: Parameters<MainEventNames[eventName]>) => void
  ): this;
  off<eventName extends keyof MainEventNames>(
    event: IsHandler<eventName> extends false ? eventName : never,
    listener: (...args: Parameters<MainEventNames[eventName]>) => void
  ): this;

  /**
   * Invoke a handler that returns a promise of a result.
   */
  invoke<eventName extends keyof MainEventNames>(
    event: IsHandler<eventName> extends true ? eventName : never,
    ...args: HandlerParams<eventName>): Promise<HandlerReturn<eventName>>;

  /**
   * Invoke a handler that returns a promise of a result.  Unlike `invoke`, this
   * does not raise an exception if the event handler is not registered.
   */
  tryInvoke<eventName extends keyof MainEventNames>(
    event: IsHandler<eventName> extends true ? eventName : never,
    ...args: HandlerParams<eventName>): Promise<HandlerReturn<eventName> | undefined>;

  /**
   * Register a handler that will handle invoke() callers.  If the given handler
   * is `undefined`, unregister it instead.
   */
  handle<eventName extends keyof MainEventNames>(
    event: IsHandler<eventName> extends true ? eventName : never,
    handler: HandlerType<eventName> | undefined,
  ): void;
}

class MainEventsImpl extends EventEmitter implements MainEvents {
  handlers: {
    [eventName in keyof MainEventNames]?: IsHandler<eventName> extends true ? HandlerType<eventName> : never;
  } = {};

  emit<eventName extends keyof MainEventNames>(
    event: IsHandler<eventName> extends false ? eventName : never,
    ...args: Parameters<MainEventNames[eventName]>
  ): boolean;

  emit(eventName: string, ...args: any[]): boolean {
    return super.emit(eventName, ...args);
  }

  on<eventName extends keyof MainEventNames>(
    event: IsHandler<eventName> extends false ? eventName : never,
    listener: (...args: Parameters<MainEventNames[eventName]>) => void
  ): this;

  on(eventName: string, listener: (...args: any[]) => void) {
    return super.on(eventName, listener);
  }

  once<eventName extends keyof MainEventNames>(
    event: IsHandler<eventName> extends false ? eventName : never,
    listener: (...args: Parameters<MainEventNames[eventName]>) => void
  ): this;

  once(eventName: string, listener: (...args: any[]) => void) {
    return super.once(eventName, listener);
  }

  off<eventName extends keyof MainEventNames>(
    event: IsHandler<eventName> extends false ? eventName : never,
    listener: (...args: Parameters<MainEventNames[eventName]>) => void
  ): this;

  off(eventName: string, listener: (...args: any[]) => void) {
    return super.off(eventName, listener);
  }

  async invoke<eventName extends keyof MainEventNames>(
    event: IsHandler<eventName> extends true ? eventName : never,
    ...args: HandlerParams<eventName>
  ): Promise<HandlerReturn<eventName>> {
    const handler: HandlerType<eventName> | undefined = this.handlers[event] as any;

    if (handler) {
      return await handler(...args);
    }
    throw new NoMainEventsHandlerError(event);
  }

  async tryInvoke<eventName extends keyof MainEventNames>(
    event: IsHandler<eventName> extends true ? eventName : never,
    ...args: HandlerParams<eventName>
  ): Promise<HandlerReturn<eventName> | undefined> {
    const handler: HandlerType<eventName> | undefined = this.handlers[event];

    return await handler?.(...args);
  }

  handle<eventName extends keyof MainEventNames>(
    event: IsHandler<eventName> extends true ? eventName : never,
    handler: HandlerType<eventName> | undefined,
  ): void {
    if (handler) {
      this.handlers[event] = handler as any;
    } else {
      delete this.handlers[event];
    }
  }
}
const mainEvents: MainEvents = new MainEventsImpl();

export default mainEvents;
