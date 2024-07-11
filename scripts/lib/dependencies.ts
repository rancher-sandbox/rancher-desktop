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
  'golangci-lint': string;
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
  spinShim: string;
  certManager: string;
  spinOperator: string;
  spinCLI: string;
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
  /**
   * Other dependencies this one requires.
   * This must be in the form <name>:<platform>, e.g. "kuberlr:linux"
   */
  dependencies?: (context: DownloadContext) => string[],
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
let _octokitAuthToken: string | undefined;

/**
 * Get a cached instance of Octokit, or create a new one as needed.  If the given token does not
 * match the one used to create the cached instance, a new one is created (and cached).
 * @param personalAccessToken Optional GitHub personal access token; defaults to GITHUB_TOKEN.
 */
export function getOctokit(personalAccessToken?: string): Octokit {
  personalAccessToken ||= process.env.GITHUB_TOKEN;

  if (!personalAccessToken) {
    throw new Error('Please set GITHUB_TOKEN to a PAT to check versions of github-based dependencies.');
  }

  if (_octokit && _octokitAuthToken === personalAccessToken) {
    return _octokit;
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

  _octokit = new Octokit({
    auth:     personalAccessToken,
    throttle: {
      onRateLimit:          makeLimitHandler('primary', 3),
      onSecondaryRateLimit: makeLimitHandler('secondary', 3),
    },
  });
  _octokitAuthToken = personalAccessToken;

  return _octokit;
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

  async createIssue(title: string, body: string, githubToken?: string): Promise<void> {
    const result = await getOctokit(githubToken).rest.issues.create({
      owner: this.owner, repo: this.repo, title, body,
    });
    const issue = result.data;

    console.log(`Created issue #${ issue.number }: "${ issue.title }"`);
  }

  async reopenIssue(issue: IssueOrPullRequest, githubToken?: string): Promise<void> {
    await getOctokit(githubToken).rest.issues.update({
      owner: this.owner, repo: this.repo, issue_number: issue.number, state: 'open',
    });
    console.log(`Reopened issue #${ issue.number }: "${ issue.title }"`);
  }

  async closeIssue(issue: IssueOrPullRequest, githubToken?: string): Promise<void> {
    await getOctokit(githubToken).rest.issues.update({
      owner: this.owner, repo: this.repo, issue_number: issue.number, state: 'closed',
    });
    console.log(`Closed issue #${ issue.number }: "${ issue.title }"`);
  }
}

// For a GitHub repository, get a list of releases that are published
// and return the tags that they were made off of.
export async function getPublishedReleaseTagNames(owner: string, repo: string, githubToken?: string) {
  const response = await getOctokit(githubToken).rest.repos.listReleases({ owner, repo });
  const releases = response.data;
  const publishedReleases = releases.filter(release => release.published_at !== null);

  return publishedReleases.map(publishedRelease => publishedRelease.tag_name);
}

// Dependencies that adhere to the following criteria may use this function
// to get a list of available versions:
// - The dependency is hosted at a GitHub repository.
// - Versions are gathered from the tag that is on each GitHub release.
// - Versions are in semver format.
export async function getPublishedVersions(githubOwner: string, githubRepo: string, includePrerelease: boolean, githubToken?: string): Promise<string[]> {
  const tagNames = await getPublishedReleaseTagNames(githubOwner, githubRepo, githubToken);
  let versions = tagNames.map((tagName: string) => tagName.replace(/^v/, ''));

  versions = versions.filter(version => semver.valid(version));
  if (!includePrerelease) {
    versions = versions.filter(version => !semver.prerelease(version));
  }

  return versions;
}
