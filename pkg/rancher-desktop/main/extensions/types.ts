/**
 * This file contains the main process side code to install extensions.
 * @see @pkg/extensions for the renderer process code.
 */

import type { ContainerEngineClient } from '@pkg/backend/containerClient';
import type { Settings } from '@pkg/config/settings';
import type { RecursiveReadonly } from '@pkg/utils/typeUtils';

export type ExtensionMetadata = {
  icon: string;
  ui?: Record<string, { title: string, root: string, src: string }>;
  vm: { image: string } | { composefile: string } | {};
  host?: { binaries: Record<'darwin' | 'windows' | 'linux', { path: string }[]>[] };
};

/**
 * A singular extension (identified by an image ID).
 * @note A reference of an extension does not imply that it is installed;
 * therefore, some operations may not be valid for uninstall extensions.
 */
export interface Extension {
  /**
   * The image ID for this extension.
   */
  readonly id: string;

  /**
   * Metadata for this extension.
   */
  readonly metadata: Promise<ExtensionMetadata>;

  /**
   * Install this extension.
   * @note If the extension is already installed, this is a no-op.
   * @return Whether the extension was installed.
   */
  install(): Promise<boolean>;
  /**
   * Uninstall this extension.
   * @note If the extension was not installed, this is a no-op.
   * @returns Whether the extension was uninstalled.
   */
  uninstall(): Promise<boolean>;

  /**
   * Extract the given file from the image.
   * @param sourcePath The name of the file (or directory) to extract, relative
   * to the root of the image; for example, `metadata.json`.
   * @param destinationPath The directory to extract into.  If this does not
   * exist and `sourcePath` is a file (rather than a directory), the contents
   * are written directly to the named file (rather than treating it as a
   * directory name).
   */
  extractFile(sourcePath: string, destinationPath: string): Promise<void>;
}

export interface ExtensionManager {
  readonly client: ContainerEngineClient;

  init(config: RecursiveReadonly<Settings>): Promise<void>;

  /**
   * Get the given extension.
   * @param id The image ID of the extension.
   * @note This may cause the given image to be downloaded.
   * @note The extension will not be automatically installed.
   */
  getExtension(id: string): Extension;

  /**
   * Get a collection of all installed extensions.
   */
  getExtensions(): Promise<{ name: string | undefined; id: string; dir: string; metadata: ExtensionMetadata; }[]>;

  /**
   * Shut down the extension manager, doing any clean up necessary.
   */
  shutdown(): Promise<void>;
}

export type SpawnOptions = {
  /**
   * The command to invoke, including arguments.  For some scopes, the
   * executable may be fixed (and therefore this only contains arguments).
   */
  command: string[];
  /**
   * Identifier for the extension that initiated the spawn.
   */
  extension: string;
  /**
   * Identifier for the spawn event, scoped to the webContents frame.
   */
  id: string;
  /**
   * The scope where the execution will take place; this is determined by which
   * API is being called.
   */
  scope: 'host' | 'docker-cli' | 'container';
  /**
   * Current working directory for the command.
   */
  cwd?: string;
  /**
   * Override the process environment variables when running this command.
   */
  env?: Record<string, string | undefined>;
};

/**
 * SpawnResult is the result of extension/spawn/blocking
 */
export type SpawnResult = {
  /** The command executed. */
  command: string;
  /** Whether the process was forcefully killed. */
  killed: boolean;
  /** The command exit code / signal. */
  result: NodeJS.Signals | number;
  stdout: string;
  stderr: string;
};

export const ExtensionErrorMarker = Symbol('extension-error');

export enum ExtensionErrorCode {
  INVALID_METADATA,
  FILE_NOT_FOUND,
}

export interface ExtensionError extends Error {
  code: ExtensionErrorCode;
  cause?: unknown;
}

export function isExtensionError(error: Error): error is ExtensionError {
  return ExtensionErrorMarker in error;
}
