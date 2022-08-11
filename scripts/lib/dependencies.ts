export type DependencyPlatform = 'wsl' | 'linux' | 'darwin' | 'win32';
export type Platform = 'linux' | 'darwin' | 'win32';
export type KubePlatform = 'linux' | 'darwin' | 'windows';

export type DownloadContext = {
  dependencyPlaform: DependencyPlatform;
  platform: Platform;
  kubePlatform: KubePlatform;
  // Difference between k8s world and docker compose makes this difficult.
  // So instead, we determine arch inside the download function.
  // arch: 'amd64' | 'arm64';
  // binDir is for binaries that the user will execute
  binDir: string;
  // internalDir is for binaries that RD will execute behind the scenes
  internalDir: string;
}

import fs from 'fs';
import YAML from 'yaml';

export class DependencyVersions {
  alpineLimaISO = '';
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

  constructor(inputObject: any) {
    for (const key in this) {
      const inputValue = inputObject[key];

      if (!inputValue) {
        throw new Error(`key "${ key }" from input object is falsy`);
      }
      Reflect.set(this, key, inputValue);
    }
  }

  static async fromYAMLFile(path: string) {
    const rawContents = await fs.promises.readFile(path, 'utf-8');
    const obj = YAML.parse(rawContents);

    return new DependencyVersions(obj);
  }
}
