import fs from 'fs';

import YAML from 'yaml';

export type DependencyPlatform = 'wsl' | 'linux' | 'darwin' | 'win32';
export type Platform = 'linux' | 'darwin' | 'win32';
export type GoPlatform = 'linux' | 'darwin' | 'windows';

export type DownloadContext = {
  versions: DependencyVersions;
  dependencyPlaform: DependencyPlatform;
  platform: Platform;
  goPlatform: GoPlatform;
  // whether we are running on M1
  isM1: boolean;
  // resourcesDir is the directory that external dependencies and the like go into
  resourcesDir: string;
  // binDir is for binaries that the user will execute
  binDir: string;
  // internalDir is for binaries that RD will execute behind the scenes
  internalDir: string;
};

export class DependencyVersions {
  limaAndQemu = '';
  alpineLimaISO = { tag: '', version: '' };
  WSLDistro = '';
  kuberlr = '';
  helm = '';
  dockerCLI = '';
  dockerBuildx = '';
  dockerCompose = '';
  trivy = '';
  steve = '';
  guestAgent = '';
  rancherDashboard = '';
  dockerProvidedCredentialHelpers = '';
  ECRCredenialHelper = '';
  hostResolver = '';
  mobyOpenAPISpec = '';

  constructor(inputObject: any) {
    for (const key in this) {
      const inputValue = inputObject[key];

      if (!inputValue) {
        throw new Error(`key "${ key }" from input object is falsy`);
      }
      this[key] = inputValue;
    }
  }

  static fromYAMLFile(path: string) {
    const rawContents = fs.readFileSync(path, 'utf-8');
    const obj = YAML.parse(rawContents);

    return new DependencyVersions(obj);
  }
}
