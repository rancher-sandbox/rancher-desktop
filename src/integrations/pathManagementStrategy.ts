let pathManager: ManualPathManager;

// PathManager is the interface that anything that manages the
// PATH variable must implement.
interface PathManager {
  // Makes real any changes to the system. Should be idempotent.
  enforce(): void
  // Removes any changes that the PathManager may have made.
  // Should be idempotent.
  remove(): void
}

// ManualPathManager is for when the user has chosen to manage
// their PATH themselves.
class ManualPathManager implements PathManager {
  enforce(): void {
    return;
  }
  remove(): void {
    return;
  }
}

// RcFilePathManager is for when the user wants Rancher Desktop to
// make changes to their PATH by putting the necessary lines in their
// .rc files.
class RcFilePathManager implements PathManager {
  constructor() {

  }
  enforce(): void {
    console.log('enforce called');
  }
  remove(): void {
    console.log('remove called');
  }
}

export enum PathManagementStrategy {
  Manual = "manual",
  RcFiles = "rcfiles",
}

// Changes the path manager to match a PathManagementStrategy and realizes the 
// changes that the new path manager represents.
export function setPathManagementStrategy(strategy: PathManagementStrategy): void {
  pathManager.remove();
  switch (strategy) {
    case PathManagementStrategy.Manual:
      pathManager = new ManualPathManager();
    case PathManagementStrategy.RcFiles:
      pathManager = new RcFilePathManager();
  }
  pathManager.enforce();
}
