let pathManager: ManualPathManager;

interface PathManager {
  enforce(): void
  remove(): void
}

class ManualPathManager implements PathManager {
  enforce(): void {
    console.log('enforce called');
  }
  remove(): void {
    console.log('remove called');
  }
}

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

export function setPathManagementStrategy(strategy: PathManagementStrategy): void {
  switch (strategy) {
    case PathManagementStrategy.Manual:
      pathManager.remove();
      pathManager = new ManualPathManager();
      pathManager.enforce();
    case PathManagementStrategy.RcFiles:
      pathManager.remove();
      pathManager = new RcFilePathManager();
      pathManager.enforce();
  }
}
