// A cross-platform script to create PRs that bump versions of dependencies.

import { spawnSync } from 'child_process';
import path from 'path';

import { Octokit } from 'octokit';
import { LimaAndQemu, AlpineLimaISO } from 'scripts/dependencies/lima';
import { MobyOpenAPISpec } from 'scripts/dependencies/moby-openapi';
import * as tools from 'scripts/dependencies/tools';
import { WSLDistro, HostResolverHost } from 'scripts/dependencies/wsl';
import {
  DependencyVersions, readDependencyVersions, writeDependencyVersions, Dependency, AlpineLimaISOVersion, getOctokit,
} from 'scripts/lib/dependencies';

const MAIN_BRANCH = 'main';
const GITHUB_OWNER = process.env.GITHUB_REPOSITORY?.split('/')[0] || 'rancher-sandbox';
const GITHUB_REPO = process.env.GITHUB_REPOSITORY?.split('/')[1] || 'rancher-desktop';

type VersionComparison = {
  name: string;
  currentVersion: string | AlpineLimaISOVersion;
  latestVersion: string | AlpineLimaISOVersion;
};

const dependencies: Dependency[] = [
  new tools.KuberlrAndKubectl(),
  new tools.Helm(),
  new tools.DockerCLI(),
  new tools.DockerBuildx(),
  new tools.DockerCompose(),
  new tools.DockerProvidedCredHelpers(),
  new tools.Trivy(),
  new tools.GuestAgent(),
  new tools.Steve(),
  new tools.RancherDashboard(),
  new tools.ECRCredHelper(),
  new LimaAndQemu(),
  new AlpineLimaISO(),
  new WSLDistro(),
  new HostResolverHost(), // we only need one of HostResolverHost and HostResolverPeer
  new MobyOpenAPISpec(),
];

function git(...args: string[]): number | null {
  const name = 'Rancher Desktop Dependency Manager';
  const email = 'donotuse@rancherdesktop.io';
  const result = spawnSync('git', args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME:     name,
      GIT_AUTHOR_EMAIL:    email,
      GIT_COMMITTER_NAME:  name,
      GIT_COMMITTER_EMAIL: email,
    },
  });

  if (result.error) {
    throw result.error;
  }

  return result.status;
}

function printable(version: string | AlpineLimaISOVersion): string {
  return typeof version === 'string' ? version : version.isoVersion;
}

function getBranchName(name: string, currentVersion: string | AlpineLimaISOVersion, latestVersion: string | AlpineLimaISOVersion): string {
  return `rddepman/${ name }/${ printable(currentVersion) }-to-${ printable(latestVersion) }`;
}

function getTitle(name: string, currentVersion: string | AlpineLimaISOVersion, latestVersion: string | AlpineLimaISOVersion): string {
  return `rddepman: bump ${ name } from ${ printable(currentVersion) } to ${ printable(latestVersion) }`;
}

/**
 * Compares the versions of two dependencies, as defined in DependencyVersions.
 * @returns true if equal, false if not equal
 */
function compareVersions(version1: string | AlpineLimaISOVersion, version2: string | AlpineLimaISOVersion): boolean {
  if (typeof version1 === 'string' && typeof version2 === 'string') {
    return version1 === version2;
  } else if (typeof version1 !== 'string' && typeof version2 !== 'string') {
    return version1.isoVersion === version2.isoVersion && version1.alpineVersion === version2.alpineVersion;
  }
  throw new Error(`Types of version1 (${ version1 }) and version2 (${ version2 }) differ.`);
}

async function createDependencyBumpPR(name: string, currentVersion: string | AlpineLimaISOVersion, latestVersion: string | AlpineLimaISOVersion): Promise<void> {
  const title = getTitle(name, currentVersion, latestVersion);
  const branchName = getBranchName(name, currentVersion, latestVersion);

  console.log(`Creating PR "${ title }".`);
  await getOctokit().rest.pulls.create({
    owner: GITHUB_OWNER,
    repo:  GITHUB_REPO,
    title,
    base:  MAIN_BRANCH,
    head:  branchName,
  });
}

type PRSearchFn = ReturnType<Octokit['rest']['search']['issuesAndPullRequests']>;

async function getPulls(name: string): Promise<Awaited<PRSearchFn>['data']['items']> {
  const queryString = `type:pr repo:${ GITHUB_OWNER }/${ GITHUB_REPO } head:rddepman/${ name } sort:updated`;
  let response: Awaited<PRSearchFn>;
  let retries = 0;

  while (true) {
    try {
      response = await getOctokit().rest.search.issuesAndPullRequests({ q: queryString });
      break;
    } catch (error: any) {
      retries += 1;
      if (retries > 2) {
        throw error;
      }
    }
  }

  return response.data.items;
}

async function checkDependencies(): Promise<void> {
  // exit if there are unstaged changes
  git('update-index', '--refresh');
  if (git('diff-index', '--quiet', 'HEAD', '--')) {
    console.log('You have unstaged changes. Commit or stash them to manage dependencies.');

    return;
  }

  // load current versions of dependencies
  const depVersionsPath = path.join('src', 'assets', 'dependencies.yaml');
  const currentVersions = await readDependencyVersions(depVersionsPath);

  // get a list of dependencies' version comparisons
  const versionComparisons: VersionComparison[] = await Promise.all(dependencies.map(async(dependency) => {
    return {
      name:           dependency.name,
      currentVersion: currentVersions[dependency.name as keyof DependencyVersions],
      latestVersion:  await dependency.getLatestVersion(),
    };
  }));

  // filter comparisons down to the ones that need an update
  const updatesAvailable = versionComparisons.filter(({ name, currentVersion, latestVersion }) => {
    const equal = compareVersions(currentVersion, latestVersion);

    if (equal) {
      console.log(`${ name } is up to date.`);
    } else {
      console.log(`Can update ${ name } from ${ currentVersion } to ${ latestVersion }`);
    }

    return !equal;
  });

  // reconcile dependencies that need an update with state of repo's PRs
  const needToCreatePR: VersionComparison[] = [];

  await Promise.all(updatesAvailable.map(async({ name, currentVersion, latestVersion }) => {
    // try to find PR for this combo of name, current version and latest version
    const prs = await getPulls(name);

    // we use title, rather than branch name, to filter pull requests
    // because branch name is not available from the search endpoint
    const title = getTitle(name, currentVersion, latestVersion);
    let prExists = false;

    await Promise.all(prs.map(async(pr) => {
      if (pr.title !== title && pr.state === 'open') {
        console.log(`Closing stale PR "${ pr.title }" (#${ pr.number }).`);
        await getOctokit().rest.pulls.update({
          owner: GITHUB_OWNER, repo: GITHUB_REPO, pull_number: pr.number, state: 'closed',
        });
      } else if (pr.title === title) {
        console.log(`Found existing PR "${ title }" (#${ pr.number }).`);
        prExists = true;
      }
    }));
    if (!prExists) {
      console.log(`Could not find PR "${ title }". Will create.`);
      needToCreatePR.push({
        name, currentVersion, latestVersion,
      });
    }
  }));

  // create a branch for each version update, make changes, and make a PR from the branch
  for (const { name, currentVersion, latestVersion } of needToCreatePR) {
    const branchName = getBranchName(name, currentVersion, latestVersion);
    const commitMessage = `Bump ${ name } from ${ currentVersion } to ${ latestVersion }`;

    git('checkout', '-b', branchName, MAIN_BRANCH);
    const depVersions = await readDependencyVersions(depVersionsPath);

    depVersions[name as keyof DependencyVersions] = latestVersion as string & AlpineLimaISOVersion;
    await writeDependencyVersions(depVersionsPath, depVersions);
    git('add', depVersionsPath);
    git('commit', '--signoff', '--message', commitMessage);
    git('push', '--force', `https://${ process.env.GITHUB_TOKEN }@github.com/${ GITHUB_OWNER }/${ GITHUB_REPO }`);
    await createDependencyBumpPR(name, currentVersion, latestVersion);
  }
}

checkDependencies().catch((e) => {
  console.error(e);
  process.exit(1);
});
