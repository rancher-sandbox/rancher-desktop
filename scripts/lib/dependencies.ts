import fs from 'fs';

import { ThrottlingOptions } from '@octokit/plugin-throttling';
import { Octokit } from 'octokit';
import semver from 'semver';
import YAML from 'yaml';

import { getResource } from './download';

export type DependencyPlatform = 'wsl' | 'linux' | 'darwin' | 'win32';
export type Platform = 'linux' | 'darwin' | 'win32';
export type GoPlatform = 'linux' | 'darwin' | 'windows';

export interface DownloadContext {
  versions:           DependencyVersions;
  dependencyPlatform: DependencyPlatform;
  platform:           Platform;
  goPlatform:         GoPlatform;
  // whether we are running on M1
  isM1:               boolean;
  // resourcesDir is the directory that external dependencies and the like go into
  resourcesDir:       string;
  // binDir is for binaries that the user will execute
  binDir:             string;
  // internalDir is for binaries that RD will execute behind the scenes
  internalDir:        string;
  // dockerPluginsDir is for docker CLI plugins.
  dockerPluginsDir:   string;
}

export interface AlpineLimaISOVersion {
  // The version of the ISO build
  isoVersion:    string;
  // The version of Alpine Linux that the ISO is built on
  alpineVersion: string
}

type Version = string | AlpineLimaISOVersion;

export interface DependencyVersions {
  lima:                            string;
  qemu:                            string;
  socketVMNet:                     string;
  alpineLimaISO:                   AlpineLimaISOVersion;
  WSLDistro:                       string;
  kuberlr:                         string;
  helm:                            string;
  dockerCLI:                       string;
  dockerBuildx:                    string;
  dockerCompose:                   string;
  'golangci-lint':                 string;
  trivy:                           string;
  steve:                           string;
  guestAgent:                      string;
  rancherDashboard:                string;
  dockerProvidedCredentialHelpers: string;
  ECRCredentialHelper:             string;
  mobyOpenAPISpec:                 string;
  wix:                             string;
  moproxy:                         string;
  spinShim:                        string;
  certManager:                     string;
  spinOperator:                    string;
  spinCLI:                         string;
  spinKubePlugin:                  string;
  'check-spelling':                string;
}

export const DEP_VERSIONS_PATH = 'pkg/rancher-desktop/assets/dependencies.yaml';

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

/**
 * A dependency is some binary that we need to track.  Generally this is some
 * third-party software, but it may also be things we build in an external
 * repository, or some binary we build from them.
 */
export interface Dependency {
  /** The name of this dependency. */
  get name(): string,
  /**
   * Other dependencies this one requires.
   * This must be in the form <name>:<platform>, e.g. "kuberlr:linux"
   */
  dependencies?: (context: DownloadContext) => string[],
  /**
   * Download this dependency.  Note that for some dependencies, this actually
   * builds from source.
   */
  download(context: DownloadContext): Promise<void>
}

/**
 * A VersionedDependency is a {@link Dependency} where we track a version and
 * can be automatically upgraded (i.e. a pull request made to bump the version).
 */
export abstract class VersionedDependency implements Dependency {
  abstract get name(): string;
  abstract download(context: DownloadContext): Promise<void>;
  /**
   * Returns the available versions of the Dependency.
   */
  abstract getAvailableVersions(): Promise<Version[]>;

  /** The current version. */
  abstract get currentVersion(): Promise<Version>;

  /** The newest version that can be upgraded to. */
  get latestVersion(): Promise<Version> {
    return (async() => {
      const availableVersions = await this.getAvailableVersions();

      return availableVersions.reduce((version1, version2) => {
        return this.rcompareVersions(version1, version2) < 0 ? version1 : version2;
      });
    })();
  }

  /** Whether we can upgrade. */
  get canUpgrade(): Promise<boolean> {
    return (async() => {
      const current = await this.currentVersion;
      const latest = await this.latestVersion;
      const compare = this.rcompareVersions(current, latest);

      if (compare < 0) {
        throw new Error(`${ this.name } at ${ current }, is greater than latest version ${ latest }`);
      }

      return compare > 0;
    })();
  }

  /**
   * Update the version manifest (e.g. `dependencies.yaml`) for this dependency,
   * in preparation for making a pull request.
   * @returns The set of files that have been modified.
   */
  abstract updateManifest(newVersion: Version): Promise<Set<string>>;

  /**
   * Compare the two versions.  The return value is:
   * Value | Description
   * --- | ---
   * -1 | `version1` is higher
   * 0 | `version1` and `version2` are equal
   * 1 | `version2` is higher
   *
   * The default implementation compares version strings that look like `0.1.2.rd3????`.
   * Note that anything after the number after `rd` is ignored.
   */
  rcompareVersions(version1: Version, version2: Version): -1 | 0 | 1 {
    if (typeof version1 !== 'string' || typeof version2 !== 'string') {
      throw new TypeError(`default rcompareVersions only handles string versions (got ${ version1 } / ${ version2 })`);
    }

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

    if (!match1 && !match2) {
      // Neither have .rd suffix; treat as equal.
      return 0;
    }
    if (!match1 || !match2) {
      // One of the two is invalid; prefer the valid one.
      return match1 ? -1 : match2 ? 1 : 0;
    }

    return Math.sign(parseInt(match2, 10) - parseInt(match1, 10)) as -1 | 0 | 1;
  }

  /** Format the version as a string for display. */
  static versionString(v: Version): string {
    return typeof v === 'string' ? v : v.isoVersion;
  }
}

/**
 * A GlobalDependency is a dependency where the version is managed in the file
 * {@link DEP_VERSIONS_PATH}.
 */
export function GlobalDependency<T extends abstract new(...args: any[]) => VersionedDependency>(Base: T) {
  abstract class GlobalDependency extends Base {
    /** The name of this dependency; it must be a key in DEP_VERSIONS_PATH. */
    abstract get name(): keyof DependencyVersions;
    /** Cache of the loaded {@link DependencyVersions}; should not be used directly. */
    static #depVersionsCache: Promise<DependencyVersions> | undefined;
    /** Get the {@link DependencyVersions} as found on disk. */
    static depVersions(): Promise<DependencyVersions> {
      GlobalDependency.#depVersionsCache ||= (async() => {
        return YAML.parse(await fs.promises.readFile(DEP_VERSIONS_PATH, 'utf-8'));
      })();

      return GlobalDependency.#depVersionsCache;
    }

    get currentVersion(): Promise<Version> {
      return GlobalDependency.depVersions().then(v => v[this.name]);
    }

    async updateManifest(newVersion: string): Promise<Set<string>> {
      // Make a copy of the read depVersions to not affect other dependencies.
      const depVersions = structuredClone(await GlobalDependency.depVersions());
      const name = this.name;

      if (name === 'alpineLimaISO') {
        throw new Error(`Default updateManifest does not handle ${ name }`);
      }
      depVersions[name] = newVersion;
      const rawContents = YAML.stringify(depVersions);

      await fs.promises.writeFile(DEP_VERSIONS_PATH, rawContents, { encoding: 'utf-8' });

      return new Set([DEP_VERSIONS_PATH]);
    }
  }

  return GlobalDependency;
}

/**
 * A filter for GitHub releases.  Available options are:
 * Value | Description
 * --- | ---
 * `published` | Get GitHub releases (excluding versions marked as *pre-release* on GitHub).
 * `published-pre` | Get GitHub releases (including those marked as *pre-release* on GitHub).
 * `semver` | GitHub releases, excluding those marked as *pre-release*, or those with semver pre-release parts.
 * `custom` | The implementation must override `getAvailableVersions()`.
 */
type ReleaseFilter = 'published' | 'published-pre' | 'semver' | 'custom';

/**
 * A {@link VersionedDependency} using GitHub releases.
 */
export abstract class GitHubDependency extends VersionedDependency {
  /** The owner / organization on GitHub. */
  abstract get githubOwner(): string;
  /** The repository name (without the owner) on GitHub. */
  abstract get githubRepo(): string;

  /** Control how to get available releases; defaults to semver. */
  readonly releaseFilter: ReleaseFilter = 'semver';
  /**
   * Converts a version (of the format that is stored in dependencies.yaml)
   * to a tag that is used in a GitHub release.
   * The default implementation adds a `v` prefix to the version string.
   */
  versionToTagName(version: Version): string {
    return `v${ version }`;
  }

  async getAvailableVersions(): Promise<Version[]> {
    if (this.releaseFilter === 'custom') {
      throw new Error('class does not override getAvailableVersions()');
    }

    const tags = await getPublishedReleaseTagNames(this.githubOwner, this.githubRepo, this.releaseFilter);

    return tags.map(tag => tag.replace(/^v/, ''));
  }
}

export interface HasUnreleasedChangesResult { latestReleaseTag: string, hasUnreleasedChanges: boolean }

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
export async function * iterateIterator<T, U>(input: AsyncIterable<T>, fn: (_: T) => U[]) {
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
  repo:  string;

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

/**
 * For a GitHub repository, get a list of published releases and return their
 * tags (including any `v` prefix).
 */
export async function getPublishedReleaseTagNames(owner: string, repo: string, releaseFilter: Exclude<ReleaseFilter, 'custom'> = 'semver', githubToken?: string): Promise<string[]> {
  const response = await getOctokit(githubToken).rest.repos.listReleases({ owner, repo });
  let releases = response.data;

  // Filter for non-draft releases
  releases = releases.filter(release => release.published_at !== null);

  // Filter out pre-releases
  if (releaseFilter !== 'published-pre') {
    releases = releases.filter(release => !release.prerelease);
  }
  let tagNames = releases.map(release => release.tag_name);

  if (releaseFilter === 'semver') {
    tagNames = tagNames.filter(tag => !semver.coerce(tag)?.prerelease?.length);
  }

  return tagNames;
}
