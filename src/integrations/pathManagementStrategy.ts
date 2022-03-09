export enum PathManagementStrategy {
  Manual = "manual",
  RcFiles = "rcfiles",
}


export function setPathManagementStrategy(strategy: PathManagementStrategy): void {
  console.log("setting mgmt strategy");
  console.log(strategy);
}
