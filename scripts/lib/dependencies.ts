import fs from 'fs';

import YAML from 'yaml';
import fetch from 'node-fetch';

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
  ECRCredentialHelper = '';
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

export interface Dependency {
  name: string,
  download(context: DownloadContext): Promise<void>
  getLatestVersion(): Promise<string>
}

/**
 * A lot of dependencies are hosted on Github via Github releases,
 * so the logic to fetch the latest version is very similar for
 * these releases. This lets us eliminate some of the duplication.
 */
export class GithubVersionGetter {
  url = '';

  async getLatestVersion(): Promise<string> {
    const latestVersionWithV = await getLatestVersion(this.url);
    return latestVersionWithV.replace('v', '');
  }
}

// We don't use https://api.github.com/repos/OWNER/REPO/releases/latest because
// it appears to not work for rancher-sandbox/dashboard (because it is a fork?).
export async function getLatestVersion(url: string): Promise<string> {
  const password = process.env.GITHUB_TOKEN;
  if (!password) {
    throw new Error('Please set GITHUB_TOKEN to a PAT to check versions of github-based dependencies.');
  };
  const user = process.env.GITHUB_USER;
  if (!user) {
    throw new Error('Please set GITHUB_USER to a github username to check versions of github-based dependencies.');
  };
  const response = await fetch(url, { headers: {
      'Authorization': 'Basic ' + Buffer.from(`${ user }:${ password }`).toString('base64'),
    }
  });
  const responseAsJSON = await response.json();
  return responseAsJSON[0].tag_name;
}