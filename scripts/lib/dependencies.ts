import fs from 'fs';

import { ThrottlingOptions } from '@octokit/plugin-throttling';
import { Octokit } from 'octokit';
import semver from 'semver';
import YAML from 'yaml';

export type DependencyPlatform = 'wsl' | 'linux' | 'darwin' | 'win32';
export type Platform = 'linux' | 'darwin' | 'win32';
export type GoPlatform = 'linux' | 'darwin' | 'windows';

export type DownloadContext = {
  versions: DependencyVersions;
  dependencyPlatform: DependencyPlatform;
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
};

export type DependencyVersions = {
  lima: string;
  limaAndQemu: string;
  alpineLimaISO: AlpineLimaISOVersion;
  WSLDistro: string;
  kuberlr: string;
  helm: string;
  dockerCLI: string;
  dockerBuildx: string;
  dockerCompose: string;
  trivy: string;
  steve: string;
  guestAgent: string;
  rancherDashboard: string;
  dockerProvidedCredentialHelpers: string;
  ECRCredentialHelper: string;
  hostResolver: string;
  mobyOpenAPISpec: string;
  wix: string;
  hostSwitch: string;
  moproxy: string;
  wasmShims: string;
};

export async function readDependencyVersions(path: string): Promise<DependencyVersions> {
  const rawContents = await fs.promises.readFile(path, 'utf-8');

  return YAML.parse(rawContents);
}

export async function writeDependencyVersions(path: string, depVersions: DependencyVersions): Promise<void> {
  const rawContents = YAML.stringify(depVersions);

  await fs.promises.writeFile(path, rawContents, { encoding: 'utf-8' });
}

export interface Dependency {
  name: string,
  download(context: DownloadContext): Promise<void>
  // Returns the available versions of the Dependency.
  // Includes prerelease versions if includePrerelease is true.
  getAvailableVersions(includePrerelease?: boolean): Promise<string[] | AlpineLimaISOVersion[]>
  // Returns -1 if version1 is higher, 0 if version1 and version2 are equal,
  // and 1 if version2 is higher.
  rcompareVersions(version1: string | AlpineLimaISOVersion, version2: string | AlpineLimaISOVersion): -1 | 0 | 1
}

/**
 * A Dependency that is hosted in a GitHub repo.
 */
export interface GitHubDependency {
  githubOwner: string
  githubRepo: string
  // Converts a version (of the format that is stored in dependencies.yaml)
  // to a tag that is used in a GitHub release.
  versionToTagName(version: string | AlpineLimaISOVersion): string
}

export type HasUnreleasedChangesResult = {latestReleaseTag: string, hasUnreleasedChanges: boolean};

export type GitHubRelease = Awaited<ReturnType<Octokit['rest']['repos']['listReleases']>>['data'][0];

let _octokit: Octokit | undefined;

export function getOctokit() {
  if (_octokit) {
    return _octokit;
  }
  const personalAccessToken = process.env.GITHUB_TOKEN;

  if (!personalAccessToken) {
    throw new Error('Please set GITHUB_TOKEN to a PAT to check versions of github-based dependencies.');
  }

  function makeLimitHandler(type: string, maxRetries: number): NonNullable<ThrottlingOptions['onSecondaryRateLimit']> {
    return (retryAfter, options, octokit, retryCount) => {
      function getOpt(prop: string) {
        return options && (prop in options) ? (options as any)[prop] : `(unknown ${ prop })`;
      }

      let message = `Request ${ type } limit exhausted for request`;
      let retry = false;

      message += ` ${ getOpt('method') } ${ getOpt('url') }`;

      if (retryCount < maxRetries) {
        retry = true;
        message += ` (retrying after ${ retryAfter } seconds: ${ retryCount }/${ maxRetries } retries)`;
      } else {
        message += ` (not retrying after ${ maxRetries } retries)`;
      }

      octokit.log.warn(message);

      return retry;
    };
  }

  return new Octokit({
    auth:     personalAccessToken,
    throttle: {
      onRateLimit:          makeLimitHandler('primary', 3),
      onSecondaryRateLimit: makeLimitHandler('secondary', 3),
    },
  });
}

export type IssueOrPullRequest = Awaited<ReturnType<Octokit['rest']['search']['issuesAndPullRequests']>>['data']['items'][0];

/**
 * Represents the main Rancher Desktop repo (rancher-sandbox/rancher-desktop
 * as of the time of writing) or one of its forks.
 */
export class RancherDesktopRepository {
  owner: string;
  repo: string;

  constructor(owner: string, repo: string) {
    this.owner = owner;
    this.repo = repo;
  }

  async createIssue(title: string, body: string): Promise<void> {
    const result = await getOctokit().rest.issues.create({
      owner: this.owner, repo: this.repo, title, body,
    });
    const issue = result.data;

    console.log(`Created issue #${ issue.number }: "${ issue.title }"`);
  }

  async reopenIssue(issue: IssueOrPullRequest): Promise<void> {
    await getOctokit().rest.issues.update({
      owner: this.owner, repo: this.repo, issue_number: issue.number, state: 'open',
    });
    console.log(`Reopened issue #${ issue.number }: "${ issue.title }"`);
  }

  async closeIssue(issue: IssueOrPullRequest): Promise<void> {
    await getOctokit().rest.issues.update({
      owner: this.owner, repo: this.repo, issue_number: issue.number, state: 'closed',
    });
    console.log(`Closed issue #${ issue.number }: "${ issue.title }"`);
  }
}

// For a github repository, get a list of releases that are published
// and return the tags that they were made off of.
export async function getPublishedReleaseTagNames(owner: string, repo: string) {
  const response = await getOctokit().rest.repos.listReleases({ owner, repo });
  const releases = response.data;
  const publishedReleases = releases.filter(release => release.published_at !== null);

  return publishedReleases.map(publishedRelease => publishedRelease.tag_name);
}

// Dependency's that adhere to the following criteria may use this function
// to get a list of available versions:
// - The Dependency is hosted at a github repository.
// - Versions are gathered from the tag that is on each github release.
// - Versions are in semver format.
export async function getPublishedVersions(githubOwner: string, githubRepo: string, includePrerelease: boolean): Promise<string[]> {
  const tagNames = await getPublishedReleaseTagNames(githubOwner, githubRepo);
  const allVersions = tagNames.map((tagName: string) => tagName.replace(/^v/, ''));

  if (!includePrerelease) {
    return allVersions.filter(version => semver.prerelease(version) === null);
  }

  return allVersions;
}
