import fs from 'fs';

import { ThrottlingOptions } from '@octokit/plugin-throttling';
import { Octokit } from 'octokit';
import semver from 'semver';
import YAML from 'yaml';

import { getResource } from './download';

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
  // dockerPluginsDir is for docker CLI plugins.
  dockerPluginsDir: string;
};

export type AlpineLimaISOVersion = {
  // The version of the ISO build
  isoVersion: string;
  // The version of Alpine Linux that the ISO is built on
  alpineVersion: string
};

export type DependencyVersions = {
  lima: string;
  qemu: string;
  socketVMNet: string;
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
  mobyOpenAPISpec: string;
  wix: string;
  moproxy: string;
  spinShim: string;
  certManager: string;
  spinOperator: string;
  spinCLI: string;
};

/**
 * rcompareVersions implementation for version strings that look like 0.1.2.rd3????.
 * Note that anything after the number after "rd" is ignored.
 * @param version1 The first version to compare.
 * @param version2 The second version to compare.
 * @returns Whether version1 is higher (-1), equal to (0), or lower than (1) version2.
 */
export function rcompareVersions(version1: string, version2: string): -1 | 0 | 1 {
  const semver1 = semver.coerce(version1);
  const semver2 = semver.coerce(version2);

  if (semver1 === null || semver2 === null) {
    throw new Error(`One of ${ version1 } and ${ version2 } failed to be coerced to semver`);
  }

  if (semver1.raw !== semver2.raw) {
    return semver.rcompare(semver1, semver2);
  }

  // If the two versions are equal, assume we have different build suffixes
  // e.g. "0.19.0.rd5" vs "0.19.0.rd6"
  const [, match1] = /^\d+\.\d+\.\d+\.rd(\d+)$/.exec(version1) ?? [];
  const [, match2] = /^\d+\.\d+\.\d+\.rd(\d+)$/.exec(version2) ?? [];

  if (!match1 || !match2) {
    // One or both are invalid; prefer the valid one.
    const fallback = Math.sign(version2.localeCompare(version1, 'en')) as -1 | 0 | 1;

    return match1 ? -1 : match2 ? 1 : fallback;
  }

  return Math.sign(parseInt(match2, 10) - parseInt(match1, 10)) as -1 | 0 | 1;
}

/**
 * Download the given checksum file (which contains multiple checksums) and find
 * the correct checksum for the given executable name.
 * @param checksumURL The URL to download the checksum from.
 * @param executableName The name of the executable expected.
 * @returns The checksum.
 */
export async function findChecksum(checksumURL: string, executableName: string): Promise<string> {
  const allChecksums = await getResource(checksumURL);
  const desiredChecksums = allChecksums.split(/\r?\n/).filter(line => line.endsWith(executableName));

  if (desiredChecksums.length < 1) {
    throw new Error(`Couldn't find a matching SHA for [${ executableName }] in [${ allChecksums }]`);
  }
  if (desiredChecksums.length === 1) {
    return desiredChecksums[0].split(/\s+/, 1)[0];
  }
  throw new Error(`Matched ${ desiredChecksums.length } hits, not exactly 1, for ${ executableName } in [${ allChecksums }]`);
}

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
export interface GitHubDependency extends Dependency {
  githubOwner: string
  githubRepo: string
  // Converts a version (of the format that is stored in dependencies.yaml)
  // to a tag that is used in a GitHub release.
  versionToTagName(version: string | AlpineLimaISOVersion): string
}

export function IsGitHubDependency(dependency: Dependency): dependency is GitHubDependency {
  if (!('githubOwner' in dependency) || typeof dependency.githubOwner !== 'string') {
    return false;
  }
  if (!('githubRepo' in dependency) || typeof dependency.githubRepo !== 'string') {
    return false;
  }
  if (!('versionToTagName' in dependency) || typeof dependency.versionToTagName !== 'function') {
    return false;
  }

  return true;
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

// Helper function to make iterating through Octokit pagination easier.
// Pass in a pagination iterator, plus a function to convert one page to a list of results.
export async function *iterateIterator<T, U>(input: AsyncIterable<T>, fn: (_: T) => U[]) {
  for await (const list of input) {
    yield * fn(list);
  }
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
