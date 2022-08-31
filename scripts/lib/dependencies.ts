import fs from 'fs';

import YAML from 'yaml';
import fetch from 'node-fetch';
import { Octokit, App } from 'octokit';

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

export type AlpineLimaISOVersion = {
  // The version of the ISO build
  isoVersion: string;
  // The version of Alpine Linux that the ISO is built on
  alpineVersion: string
}

export class DependencyVersions {
  limaAndQemu = '';
  alpineLimaISO: AlpineLimaISOVersion = { isoVersion: '', alpineVersion: '' };
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
  getLatestVersion(): Promise<string | AlpineLimaISOVersion>
}

/**
 * A lot of dependencies are hosted on Github via Github releases,
 * so the logic to fetch the latest version is very similar for
 * these releases. This lets us eliminate some of the duplication.
 */
export class GithubVersionGetter {
  githubOwner = '';
  githubRepo = '';

  async getLatestVersion(): Promise<string> {
    const response = await octokit.rest.repos.listReleases({owner: this.githubOwner, repo: this.githubRepo});
    const latestVersionWithV = response.data[0].tag_name;
    return latestVersionWithV.replace('v', '');
  }
}

const personalAccessToken = process.env.GITHUB_TOKEN;
if (!personalAccessToken) {
  throw new Error('Please set GITHUB_TOKEN to a PAT to check versions of github-based dependencies.');
};
export const octokit = new Octokit({auth: personalAccessToken});