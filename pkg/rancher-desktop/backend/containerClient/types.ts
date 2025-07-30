import type { Log } from '@pkg/utils/logging';

import type { ChildProcessByStdio, SpawnOptions } from 'child_process';
import type { Readable } from 'stream';

export interface ContainerBasicOptions {
  /**
   * Namespace the container should be created in.
   * @note Silently ignored when using moby.
   */
  namespace?: string;
}

/**
 * ContainerRunOptions are the options the can be passed to
 * ContainerEngineClient.run().  All fields are optional.
 */
export type ContainerRunOptions = ContainerBasicOptions & {
  /** The name of the container. */
  name?:    string;
  /** Container restart policy, defaults to "no". */
  restart?: 'always' | 'no';
};

/**
 * ContainerStopOptions are the options that can be passed to
 * ContainerEngineClient.stop().  All fields are optional.
 */
export type ContainerStopOptions = ContainerBasicOptions & {
  /** Force stop the container (killing it uncleanly). */
  force?:  true;
  /** Delete the container after stopping. */
  delete?: true;
};

/**
 * ContainerComposeOptions are options that can be passed to
 * ContainerEngineClient.composeUp() and .composeDown().  All fields are
 * optional.
 */
export type ContainerComposeOptions = ContainerBasicOptions & {
  /** The directory holding the compose files. */
  composeDir: string;
  /** The name of the project */
  name?:      string;
  /** Environment variables to set on build */
  env?:       Record<string, string>;
};

export type ContainerComposeExecOptions = ContainerComposeOptions & {
  /** The service to exec in. */
  service:  string;
  /** The command (and arguments) to execute. */
  command:  string[];
  /** Run the command as the given (in-container) user. */
  user?:    string,
  /** Run the command in the given (in-container) directory */
  workdir?: string;
};

/** ReadableProcess describes a process that is capturing output */
export type ReadableProcess = ChildProcessByStdio<null, Readable, Readable>;

export type ContainerComposePortOptions = ContainerComposeOptions & {
  /** The service to find the port for */
  service:  string;
  /** The private port to map */
  port:     number;
  /** The protocol to use */
  protocol: 'tcp' | 'udp';
};

/**
 * ContainerRunClientOptions describes arguments to
 * ContainerEngineClient.runClient()
 */
export type ContainerRunClientOptions = SpawnOptions & { namespace?: string };

/**
 * ContainerEngineClient is used to run commands on the container engine.
 */
export interface ContainerEngineClient {
  /**
   * Block until the container engine is ready.
   */
  waitForReady(): Promise<void>;

  /**
   * Read the file from the given container image.
   * @param imageID The ID of the image to read.
   * @param filePath The file to read, relative to the root of the container.
   * @param [options.encoding='utf-8'] The encoding to read.
   * @param [options.namespace] Namespace the image is in, if supported.
   */
  readFile(imageID: string, filePath: string): Promise<string>;
  readFile(imageID: string, filePath: string, options: { encoding?: BufferEncoding, namespace?: string }): Promise<string>;

  /**
   * Copy the given file to disk.
   * @param imageID The ID of the image to copy files from.
   * @param sourcePath The source path (inside the image) to copy from.
   * This may be the path to a file or a directory.  If this is a directory, it
   * must end with a slash.
   * @param destinationDir The destination path (on the host) to copy to.
   * If sourcePath is a directory, then its contents will be place here without
   * an extra directory.  Otherwise, this is the parent directory, and the
   * named file will be created within this directory with the same base name as
   * in the VM.
   * @param [options.namespace] Namespace the image is in, if supported.
   * @note Symbolic links are always resolved, as some hosts might not support
   * them.
   */
  copyFile(imageID: string, sourcePath: string, destinationDir: string): Promise<void>;
  copyFile(imageID: string, sourcePath: string, destinationDir: string, options: { namespace?: string }): Promise<void>;

  /**
   * Get all tags available for the given image name.
   * @param imageName the image name, possibly including the registry, but
   *        excluding the tag.
   */
  getTags(imageName: string, options?: ContainerBasicOptions): Promise<Set<string>>;

  /**
   * Start a container.
   * @param imageID The ID of the image to use.
   * @note The container will be run detached (no IO).
   * @returns The container ID.
   */
  run(imageID: string, options?: ContainerRunOptions): Promise<string>;

  /**
   * Stop the given container, if it exists and is running.
   */
  stop(container: string, options?: ContainerStopOptions): Promise<void>;

  /**
   * Start containers via `docker compose` / `nerdctl compose`.
   */
  composeUp(options: ContainerComposeOptions): Promise<void>;

  /**
   * Stop containers via `docker compose` / `nerdctl compose`.
   */
  composeDown(options?: ContainerComposeOptions): Promise<void>;

  /**
   * Spawn a process using `docker compose exec` / `nerdctl ...`, returning a
   * raw process that has stdout and stderr set to pipe (but nothing for stdin).
   */
  composeExec(options: ContainerComposeExecOptions): Promise<ReadableProcess>;

  /**
   * Get port information for a compose service.
   * @returns The port information, looking like `0.0.0.0:12345`.
   */
  composePort(options: ContainerComposePortOptions): Promise<string>;

  /**
   * Run the client directly, using the given arguments.  The 'stdio' argument
   * determines the return value.
   */
  runClient(args: string[], stdio?: 'ignore', options?: ContainerRunClientOptions): Promise<Record<string, never>>;
  runClient(args: string[], stdio: Log, options?: ContainerRunClientOptions): Promise<Record<string, never>>;
  runClient(args: string[], stdio: 'pipe', options?: ContainerRunClientOptions): Promise<{ stdout: string, stderr: string }>;
  runClient(args: string[], stdio: 'stream', options?: ContainerRunClientOptions): ReadableProcess;
}
