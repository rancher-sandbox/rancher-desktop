// Definitions only

/**
 * PathManager is the interface that anything that manages the
 *  PATH variable must implement.
 */
export interface PathManager {
  /** The PathManagementStrategy that corresponds to the implementation. */
  readonly strategy: PathManagementStrategy
  /** Makes real any changes to the system. Should be idempotent. */
  enforce(): Promise<void>
  /** Removes any changes that the PathManager may have made. Should be idempotent. */
  remove(): Promise<void>
}

/**
 * ManualPathManager is for when the user has chosen to manage
 * their PATH themselves. It does nothing.
 */
export class ManualPathManager implements PathManager {
  readonly strategy = PathManagementStrategy.Manual;
  async enforce(): Promise<void> {}
  async remove(): Promise<void> {}
}

export enum PathManagementStrategy {
  Manual = 'manual',
  RcFiles = 'rcfiles',
}
