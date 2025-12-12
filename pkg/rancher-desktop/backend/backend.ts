import fs from 'fs';
import stream from 'stream';

import { Settings } from '@pkg/config/settings';
import * as childProcess from '@pkg/utils/childProcess';
import EventEmitter from '@pkg/utils/eventEmitter';
import { RecursiveKeys, RecursivePartial, RecursiveReadonly } from '@pkg/utils/typeUtils';

import type { ContainerEngineClient } from './containerClient';
import type { KubernetesBackend } from './k8s';

export enum State {
  STOPPED = 'STOPPED', // The engine is not running.
  STARTING = 'STARTING', // The engine is attempting to start.
  STARTED = 'STARTED', // The engine is started; the dashboard is not yet ready.
  STOPPING = 'STOPPING', // The engine is attempting to stop.
  ERROR = 'ERROR', // There is an error and we cannot recover automatically.
  DISABLED = 'DISABLED', // The container backend is ready but the Kubernetes engine is disabled.
}

export class BackendError extends Error {
  constructor(name: string, message: string, fatal = false) {
    super(message);
    this.name = name;
    this.fatal = fatal;
  }

  readonly fatal: boolean;
}

export interface BackendProgress {
  /** The current progress; valid values are 0 to max. */
  current:         number,
  /** Maximum progress possible; if less than zero, the progress is indeterminate. */
  max:             number,
  /** Details on the current action. */
  description?:    string,
  /** When we entered this progress state. */
  transitionTime?: Date,
}

export type Architecture = 'x86_64' | 'aarch64';

export interface FailureDetails {
  /** The last lima/wsl command run: */
  lastCommand?:       string,
  lastCommandComment: string,
  lastLogLines:       string[],
}

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
export type BackendSettings = RecursiveReadonly<Settings>;

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
  current:  any;
  /**
   * The desired value (which must be different from the current value to
   * require a restart).
   */
  desired:  any;
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
export interface VMBackend extends EventEmitter<BackendEvents> {
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
   * @returns Null if the backend is valid; otherwise, an error describing why
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
   * Apply the settings update that does not require a backend restart.
   */
  handleSettingsUpdate(config: BackendSettings): Promise<void>;

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
   * If true, the backend cannot invoke any dialog boxes and needs to find an alternative.
   */
  noModalDialogs: boolean;

  readonly executor:              VMExecutor;
  readonly kubeBackend:           KubernetesBackend;
  readonly containerEngineClient: ContainerEngineClient;
}

/**
 * execOptions is options for VMExecutor.
 */
export type execOptions = childProcess.CommonOptions & {
  /** Expect the command to fail; do not log on error.  Exceptions are still thrown. */
  expectFailure?: boolean;
  /** A custom log stream to write to; must have a file descriptor. */
  logStream?:     stream.Writable;
  /**
   * If set, ensure that the command is run as the privileged user.
   * @note The command is always run as root on WSL.
   */
  root?:          boolean;
};

/**
 * VMExecutor describes how to run commands in the virtual machine.
 */
export interface VMExecutor {
  /**
   * The backend in use.
   */
  readonly backend: VMBackend['backend'];

  /**
   * execCommand runs the given command in the virtual machine.
   * @param execOptions Execution options.  If capture is set, standard output is
   *    returned.
   * @param command The command to execute.
   */
  execCommand(...command: string[]): Promise<void>;
  execCommand(options: execOptions, ...command: string[]): Promise<void>;
  execCommand(options: execOptions & { capture: true }, ...command: string[]): Promise<string>;

  /**
   * spawn the given command in the virtual machine, returning the child
   * process itself.
   * @note On Windows, this will be within the network / pid namespace.
   * @param options Execution options.
   * @param command The command to execute.
   */
  spawn(...command: string[]): childProcess.ChildProcess;
  spawn(options: execOptions, ...command: string[]): childProcess.ChildProcess;

  /**
   * Read the contents of the given file.  If the file is a symlink, the target
   * will be read instead.
   * @param filePath The path inside the VM to read.
   * @param [options.encoding='utf-8'] The encoding of the file.
   * @returns The contents of the file.
   */
  readFile(filePath: string): Promise<string>;
  readFile(filePath: string, options: Partial<{ encoding: BufferEncoding }>): Promise<string>;

  /**
   * Write the given contents to a given file name in the VM.
   * The file will be owned by root.
   * @param filePath The destination file path, in the VM.
   * @param fileContents The contents of the file.
   * @param permissions The file permissions. Defaults to 0o644.
   */
  writeFile(filePath: string, fileContents: string): Promise<void>;
  writeFile(filePath: string, fileContents: string, permissions: fs.Mode): Promise<void>;

  /**
   * Copy the given file from the host into the VM.
   * @param hostPath The source path, on the host.
   * @param vmPath The destination path, inside the VM.
   * @note The behaviour of copying a directory is undefined.
   */
  copyFileIn(hostPath: string, vmPath: string): Promise<void>;

  /**
   * Copy the given file from the VM into the host.
   * @param vmPath The source path, inside the VM.
   * @param hostPath The destination path, on the host.
   * @note The behaviour of copying a directory is undefined.
   */
  copyFileOut(vmPath: string, hostPath: string): Promise<void>;
}
