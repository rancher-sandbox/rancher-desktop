/**
 * This file contains the main process side code to install extensions.
 * @see @pkg/extensions for the renderer process code.
 */
import type { ContainerEngineClient } from '@pkg/backend/containerClient';
import type { Settings } from '@pkg/config/settings';
import type { RecursiveReadonly } from '@pkg/utils/typeUtils';

type PlatformSpecific<T> = Record<'darwin' | 'windows' | 'linux', T>;

export interface ExtensionMetadata {
  /** Icon for the extension, as a path in the image. */
  icon: string;
  /** UI endpoints. Currently only "dashboard-tab" is supported. */
  ui?: {
    'dashboard-tab'?: {
      /** The title of the UI, as shown in the side bar. */
      title:    string;
      /** Root of the directory inside the image holding the UI files. */
      root:     string;
      /** The initial HTML page to load, relative to root. */
      src:      string;
      /** Information on the backend to expose. */
      backend?: {
        /** The name of the socket, as found in vm.exposes.socket */
        socket: string;
      }
    }
  }
  /** Containers to run. */
  vm?: ({ image: string } | { composefile: string }) & {
    /** Things to expose to the UI */
    exposes?: {
      /** Path to a Unix socket to expose; this is in `/run/guest-services/`. */
      socket: string;
    }
  };
  host?: {
    /** Files to copy to the host. */
    binaries:          PlatformSpecific<{ path: string }[]>[],
    /**
     * Rancher Desktop extension: this will be run after the extension is
     * installed (possibly as an upgrade).  This file should be listed in
     * `binaries`.  Errors will be ignored.
     */
    'x-rd-install'?:   PlatformSpecific<string | string[]>,
    /**
     * Rancher Desktop extension: this will be run before the extension is
     * uninstalled (possibly as an upgrade).  This file should be listed in
     * `binaries`.  Errors will be ignored.
     */
    'x-rd-uninstall'?: PlatformSpecific<string | string[]>,
    /**
     * Rancher Desktop extension: this will be executed when the application
     * quits.  The application may exit before the process completes.  It is not
     * defined what the container engine / Kubernetes cluster may be doing at
     * the time this is called.
     */
    'x-rd-shutdown'?:  PlatformSpecific<string | string[]>,
  };
}

/**
 * A singular extension (identified by an image ID).
 * @note A reference of an extension does not imply that it is installed;
 * therefore, some operations may not be valid for uninstall extensions.
 */
export interface Extension {
  /**
   * The image ID for this extension, excluding the tag.
   */
  readonly id: string;

  /**
   * The image tag for this extension.
   */
  readonly version: string;

  /**
   * The full image tag for this image (a combination of id and version).
   */
  readonly image: string;

  /**
   * Metadata for this extension.
   */
  readonly metadata: Promise<ExtensionMetadata>;

  /**
   * Image labels associated with this extension.
   */
  readonly labels: Promise<Record<string, string>>;

  /**
   * Install this extension.
   * @param allowedImages The list of extension images that are allowed to be
   *        used; if all images are allowed, pass in undefined.
   * @note If the extension is already installed, this is a no-op.
   * @throws If the settings specify an allow list and this is not in it.
   * @return Whether the extension was installed.
   */
  install(allowedImages: readonly string[] | undefined): Promise<boolean>;
  /**
   * Uninstall this extension.
   * @note If the extension was not installed, this is a no-op.
   * @returns Whether the extension was uninstalled.
   */
  uninstall(): Promise<boolean>;

  /**
   * Check whether this extension is installed (at this version).
   */
  isInstalled(): Promise<boolean>;

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
   * @param image The image reference of the extension, possibly including the
   *        tag.  If the tag is not supplied, the currently-installed version is
   *        used (see options.preferInstalled); if no version is installed,
   *        "latest" is assumed.
   * @param [options.preferInstalled=true] If the given image reference does not
   *        include tags and the extension is already installed, return the
   *        currently installed version.
   * @note This may cause the given image to be downloaded.
   * @note The extension will not be automatically installed.
   */
  getExtension(image: string, options?: { preferInstalled?: boolean }): Promise<Extension>;

  /**
   * Get a collection of all installed extensions.
   */
  getInstalledExtensions(): Promise<Extension[]>;

  /**
   * Shut down the extension manager, doing any clean up necessary.
   */
  shutdown(): Promise<void>;
}

export interface SpawnOptions {
  /**
   * The command to invoke, including arguments.  For some scopes, the
   * executable may be fixed (and therefore this only contains arguments).
   */
  command: string[];
  /**
   * Identifier for the spawn event, scoped to the webContents frame.
   */
  execId:  string;
  /**
   * The scope where the execution will take place; this is determined by which
   * API is being called.
   */
  scope:   'host' | 'docker-cli' | 'container';
  /**
   * Current working directory for the command.
   */
  cwd?:    string;
  /**
   * Override the process environment variables when running this command.
   */
  env?:    Record<string, string | undefined>;
}

/**
 * SpawnResult is the result of extension/spawn/blocking
 */
export interface SpawnResult {
  /** The command executed. */
  cmd:     string;
  /** Whether the process was forcefully killed via the API. */
  killed?: boolean;
  /** The command exit code / signal. */
  result:  NodeJS.Signals | number;
  stdout:  string;
  stderr:  string;
}

export const ExtensionErrorMarker = Symbol('extension-error');

export enum ExtensionErrorCode {
  INVALID_METADATA,
  FILE_NOT_FOUND,
  INSTALL_DENIED,
}

export interface ExtensionError extends Error {
  code:   ExtensionErrorCode;
  cause?: unknown;
}

export function isExtensionError(error: Error): error is ExtensionError {
  return ExtensionErrorMarker in error;
}
