type ContainerBasicOptions = {
  /**
   * Namespace the container should be created in.
   * @note Silently ignored when using moby.
   */
  namespace?: string;
};

/**
 * ContainerRunOptions are the options the can be passed to
 * ContainerEngineClient.run().  All fields are optional.
 */
export type ContainerRunOptions = ContainerBasicOptions & {
  /** The name of the container. */
  name?: string;
  /** Container restart policy, defaults to "no". */
  restart?: 'always' | 'no';
};

/**
 * ContainerStopOptions are the options that can be passed to
 * ContainerEngineClient.stop().  All fields are optional.
 */
export type ContainerStopOptions = ContainerBasicOptions & {
  /** Force stop the container (killing it uncleanly). */
  force?: true;
  /** Delete the container after stopping. */
  delete?: true;
};

/**
 * ContainerComposeOptions are options that can be passed to
 * ContainerEngineClient.composeUp() and .composeDown().  All fields are
 * optional.
 */
export type ContainerComposeOptions = ContainerBasicOptions & {
  /** The name of the project */
  name?: string;
  /** Environment variables to set on build */
  env?: Record<string, string>;
};

/**
 * ContainerEngineClient is used to run commands on the container engine.
 */
export interface ContainerEngineClient {
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
   * @param [options.resolveSymlinks] Follow symlinks in the source; default true.
   * @param [options.namespace] Namespace the image is in, if supported.
   * @note Symbolic links might not be copied correctly (for example, the host might be Windows).
   */
  copyFile(imageID: string, sourcePath: string, destinationDir: string): Promise<void>;
  copyFile(imageID: string, sourcePath: string, destinationDir: string, options: { resolveSymlinks?: false, namespace?: string }): Promise<void>;

  /**
   * Start a container.
   * @param imageID The ID of the image to use.
   * @note The container will be run detached (no IO).
   * @returns The container ID.
   */
  run(imageID: string, options?: ContainerRunOptions): Promise<string>;

  /**
   * Start containers via `docker compose` / `nerdctl compose`.
   * @param composeDir The path containing the compose file.
   */
  composeUp(composeDir: string, options?: ContainerComposeOptions): Promise<void>;

  /**
   * Stop the given container, if it exists and is running.
   */
  stop(container: string, options?: ContainerStopOptions): Promise<void>;

  composeDown(composeDir: string, options?: ContainerComposeOptions): Promise<void>;

  /** Escape hatch (for now): the executable to run */
  readonly executable: string;
}
