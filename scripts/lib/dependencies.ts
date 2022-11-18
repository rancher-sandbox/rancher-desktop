import fs from 'fs';

import { Octokit } from 'octokit';
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

export type AlpineLimaISOVersion = {
  // The version of the ISO build
  isoVersion: string;
  // The version of Alpine Linux that the ISO is built on
  alpineVersion: string
};

export type DependencyVersions = {
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
  getLatestVersion(): Promise<string | AlpineLimaISOVersion>
}

/**
 * Types that implement UnreleasedChangeMonitor can tell you whether
 * there have been any changes in their repository since their last release.
 */
export interface UnreleasedChangeMonitor {
  hasUnreleasedChanges(): Promise<HasUnreleasedChangesResult>
}

export type HasUnreleasedChangesResult = {latestReleaseTag: string, hasUnreleasedChanges: boolean};

type GithubRelease = Awaited<ReturnType<Octokit['rest']['repos']['listReleases']>>['data'][0];

async function getLatestPublishedRelease(githubOwner: string, githubRepo: string): Promise<GithubRelease> {
  const response = await getOctokit().rest.repos.listReleases({ owner: githubOwner, repo: githubRepo });

  for (const release of response.data) {
    if (release.published_at !== null) {
      return release;
    }
  }
  throw new Error(`Did not find a published release for ${ githubOwner }/${ githubRepo }`);
}

/**
 * Tells the caller whether the given github repo has any
 * changes that have not been released.
 */
export async function hasUnreleasedChanges(githubOwner: string, githubRepo: string): Promise<HasUnreleasedChangesResult> {
  const latestRelease = await getLatestPublishedRelease(githubOwner, githubRepo);

  // Get the date of the commit that the release's tag points to.
  // We can't use the publish date of the release, because that
  // omits commits that were made after the commit that was tagged
  // for the release, but before the actual release.
  const result = await getOctokit().rest.repos.getCommit({
    owner: githubOwner, repo: githubRepo, ref: latestRelease.tag_name,
  });
  const dateOfTaggedCommit = result.data.commit.committer?.date;

  const response = await getOctokit().rest.repos.listCommits({
    owner: githubOwner, repo: githubRepo, since: dateOfTaggedCommit,
  });
  const commits = response.data;

  console.log(`Found ${ commits.length - 1 } unreleased commits for repository ${ githubOwner }/${ githubRepo }.`);

  return {
    latestReleaseTag:     latestRelease.tag_name,
    hasUnreleasedChanges: commits.length > 1,
  };
}

/**
 * A lot of dependencies are hosted on Github via Github releases,
 * so the logic to fetch the latest version/tag is very similar for
 * these releases. This lets us eliminate some of the duplication.
 */
export class GithubVersionGetter {
  name = 'GithubVersionGetter';
  githubOwner?: string;
  githubRepo?: string;

  async getLatestVersion(): Promise<string> {
    if (!this.githubOwner) {
      throw new Error(`Must define property "githubOwner" for dependency ${ this.name }`);
    }
    if (!this.githubRepo) {
      throw new Error(`Must define property "githubRepo" for dependency ${ this.name }`);
    }
    const release = await getLatestPublishedRelease(this.githubOwner, this.githubRepo);
    const latestVersionWithV = release.tag_name;

    return latestVersionWithV.replace(/^v/, '');
  }
}

let _octokit: Octokit | undefined;

export function getOctokit() {
  if (_octokit) {
    return _octokit;
  }
  const personalAccessToken = process.env.GITHUB_TOKEN;

  if (!personalAccessToken) {
    throw new Error('Please set GITHUB_TOKEN to a PAT to check versions of github-based dependencies.');
  }

  return new Octokit({ auth: personalAccessToken });
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
