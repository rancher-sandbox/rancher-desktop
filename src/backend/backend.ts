import { Settings } from '@/config/settings';
import { RecursiveKeys, RecursivePartial, RecursiveReadonly } from '@/utils/typeUtils';

export enum State {
  STOPPED = 0, // The engine is not running.
  STARTING, // The engine is attempting to start.
  STARTED, // The engine is started; the dashboard is not yet ready.
  STOPPING, // The engine is attempting to stop.
  ERROR, // There is an error and we cannot recover automatically.
  DISABLED, // The container backend is ready but the Kubernetes engine is disabled.
}

export class BackendError extends Error {
  constructor(name: string, message: string, fatal = false) {
    super(message);
    this.name = name;
    this.fatal = fatal;
  }

  readonly fatal: boolean;
}

export type BackendProgress = {
  /** The current progress; valid values are 0 to max. */
  current: number,
  /** Maximum progress possible; if less than zero, the progress is indeterminate. */
  max: number,
  /** Details on the current action. */
  description?: string,
  /** When we entered this progress state. */
  transitionTime?: Date,
};

export type Architecture = 'x86_64' | 'aarch64';

export type FailureDetails = {
  /** The last lima/wsl command run: */
  lastCommand?: string,
  lastCommandComment: string,
  lastLogLines: Array<string>,
};

/**
 * KubernetesBackendEvents describes the events that may be emitted by a
 * Kubernetes backend (as an EventEmitter).  Each property name is the name of
 * an event, and the property type is the type of the callback function expected
 * for the given event.
 */
export interface BackendEvents {
  /**
   * Emitted when there has been a change in the progress in the current action.
   * The progress can be read off the `progress` member on the backend.
   */
  'progress'(): void;

  /**
   * Emitted when the state of the backend has changed.
   */
  'state-changed'(state: State): void;

  /**
   * Show a notification to the user.
   */
  'show-notification'(options: Electron.NotificationConstructorOptions): void;
}

/**
 * Settings that KubernetesBackend can access.
 */
export type BackendSettings = RecursiveReadonly<Settings['kubernetes']>;

/**
 * Reasons that the backend might need to restart, as returned from
 * `requiresRestartReasons()`.
 * @returns A mapping of the preference causing the restart to the changed
 *          values.
 */
export type RestartReasons = Partial<Record<RecursiveKeys<Settings>, {
  /**
   * The currently active value.
   */
  current: any;
  /**
   * The desired value (which must be different from the current value to
   * require a restart).
   */
  desired: any;
  /**
   * The severity of the restart; this may be set to `reset` for some values
   * indicating that there will be data loss.
   */
  severity: 'restart' | 'reset';
}>>;

/**
 * VMBackend describes a controller for managing a virtual machine upon which
 * Rancher Desktop runs.
 */
export interface VMBackend {
  /** The name of the VM backend */
  readonly backend: 'wsl' | 'lima' | 'mock';

  readonly state: State;

  /** The number of CPUs in the running VM, or 0 if the VM is not running. */
  readonly cpus: Promise<number>;

  /** The amount of memory in the VM, in MiB, or 0 if the VM is not running. */
  readonly memory: Promise<number>;

  /** Progress for the current action. */
  readonly progress: Readonly<BackendProgress>;

  /**
   * Whether debug mode is enabled. If this is set, the implementation should
   * emit extra debug logging if possible.
   */
  debug: boolean;

  /**
   * Check if the current backend is valid.
   * @returns Null if the backend is valid, otherwise an error describing why
   * the backend is invalid that can be shown to the user.
   */
  getBackendInvalidReason(): Promise<BackendError | null>;

  /**
   * Start the Kubernetes cluster.  If it is already started, it will be
   * restarted.
   */
  start(config: BackendSettings): Promise<void>;

  /** Stop the Kubernetes cluster.  If applicable, shut down the VM. */
  stop(): Promise<void>;

  /** Delete the Kubernetes cluster, returning the exit code. */
  del(): Promise<void>;

  /** Reset the Kubernetes cluster, removing all workloads. */
  reset(config: BackendSettings): Promise<void>;

  /**
   * Reset the cluster, completely deleting any user configuration.  This does
   * not automatically restart the cluster.
   */
  factoryReset(keepSystemImages: boolean): Promise<void>;

  /**
   * Check if applying the given settings would require the backend to restart.
   */
  requiresRestartReasons(config: RecursivePartial<BackendSettings>): Promise<RestartReasons>;

  /**
   * Get the external IP address where the services would be listening on, if
   * available.  For VM-based systems, this would be the address of the VM's
   * network interface.  This address may be undefined if the backend is
   * currently not in a state that supports services; for example, if the VM is
   * off.
   */
  readonly ipAddress: Promise<string | undefined>;

  /**
   * If called after a backend operation fails, this returns a block of data that attempts
   * to give more information about what command was being run when the error happened.
   *
   * @param [exception] The associated exception.
   */
  getFailureDetails(exception: any): Promise<FailureDetails>;

  /**
   * A description of the last backend command, usually displayed by the progress tracker,
   * but available for the `FailureDetails` block.
   */
  readonly lastCommandComment: string;

  /**
   * If true, the backend cannot invoke any dialog boxes and needs to find an alternative.
   */
  noModalDialogs: boolean;
}
