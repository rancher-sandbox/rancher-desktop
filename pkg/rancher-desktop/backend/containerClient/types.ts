/**
 * ContainerRunOptions are the options the can be passed to
 * ContainerEngineClient.run().  All fields are optional.
 */
export type ContainerRunOptions = {
  /**
   * Namespace the container should be created in.
   * @note Silently ignored when using moby.
   */
  namespace?: string;
  /** The name of the container. */
  name?: string;
  /** Container restart policy, defaults to "no". */
  restart?: 'always' | 'no';
};

/**
 * ContainerStopOptions are the options that can be passed to
 * ContainerEngineClient.stop().  All fields are optional.
 */
export type ContainerStopOptions = {
  /**
   * Namespace the container should be created in.
   * @note Silently ignored when using moby.
   */
  namespace?: string;
  /** Force stop the container (killing it uncleanly). */
  force?: true;
  /** Delete the container after stopping. */
  delete?: true;
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
   */
  readFile(imageID: string, filePath: string): Promise<string>;
  readFile(imageID: string, filePath: string, options: { encoding?: BufferEncoding }): Promise<string>;

  /**
   * Copy the given file to disk.
   * @param imageID The ID of the image to copy files from.
   * @param sourcePath The source path (inside the image) to copy from.
   * @param destinationDir The destination path (on the host) to copy to.
   * This is always the parent directory; the base name of the output will be
   * the base name of the sourcePath.
   * @param [options.resolveSymlinks] Follow symlinks in the source; default true.
   * @note Symbolic links might not be copied correctly (for example, the host might be Windows).
   */
  copyFile(imageID: string, sourcePath: string, destinationDir: string): Promise<void>;
  copyFile(imageID: string, sourcePath: string, destinationDir: string, options: { resolveSymlinks: false }): Promise<void>;

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

  /** Escape hatch (for now): the executable to run */
  readonly executable: string;
}
