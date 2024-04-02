// A cross-platform script to create PRs that bump versions of dependencies.

import { spawnSync } from 'child_process';
import path from 'path';

import { Octokit } from 'octokit';

import { Lima, LimaAndQemu, AlpineLimaISO } from 'scripts/dependencies/lima';
import { MobyOpenAPISpec } from 'scripts/dependencies/moby-openapi';
import * as tools from 'scripts/dependencies/tools';
import { Wix } from 'scripts/dependencies/wix';
import { WSLDistro, HostResolverHost, HostSwitch, Moproxy } from 'scripts/dependencies/wsl';
import {
  DependencyVersions, readDependencyVersions, writeDependencyVersions, Dependency, AlpineLimaISOVersion, getOctokit,
} from 'scripts/lib/dependencies';

const MAIN_BRANCH = 'main';
const GITHUB_OWNER = process.env.GITHUB_REPOSITORY?.split('/')[0] || 'rancher-sandbox';
const GITHUB_REPO = process.env.GITHUB_REPOSITORY?.split('/')[1] || 'rancher-desktop';
const DEP_VERSIONS_PATH = path.join('pkg', 'rancher-desktop', 'assets', 'dependencies.yaml');

type VersionComparison = {
  dependency: Dependency;
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
  new Lima(),
  new LimaAndQemu(),
  new AlpineLimaISO(),
  new WSLDistro(),
  new HostResolverHost(), // we only need one of HostResolverHost and HostResolverPeer
  new Wix(),
  new MobyOpenAPISpec(),
  new HostSwitch(),
  new Moproxy(),
  new tools.WasmShims(),
];

function git(...args: string[]): number | null {
  const name = 'Rancher Desktop Dependency Manager';
  const email = 'donotuse@rancherdesktop.io';
  const result = spawnSync('git', args, {
    stdio: 'inherit',
    env:   {
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

async function createDependencyBumpPR(name: string, currentVersion: string | AlpineLimaISOVersion, latestVersion: string | AlpineLimaISOVersion): Promise<void> {
  const title = getTitle(name, currentVersion, latestVersion);
  const branchName = getBranchName(name, currentVersion, latestVersion);

  console.log(`Creating PR "${ title }".`);
  try {
    await getOctokit().rest.pulls.create({
      owner: GITHUB_OWNER,
      repo:  GITHUB_REPO,
      title,
      base:  MAIN_BRANCH,
      head:  branchName,
    });
  } catch (err: any) {
    console.log(JSON.stringify(err.response?.data));
    throw err;
  }
}

type PRSearchFn = ReturnType<Octokit['rest']['search']['issuesAndPullRequests']>;

async function getPulls(name: string): Promise<Awaited<PRSearchFn>['data']['items']> {
  const queryString = `type:pr repo:${ GITHUB_OWNER }/${ GITHUB_REPO } head:rddepman/${ name } sort:updated`;
  const response = await getOctokit().rest.search.issuesAndPullRequests({ q: queryString });

  const results: typeof response.data.items = [];

  for (const item of response.data.items) {
    if (!item.pull_request) {
      continue;
    }
    const { data: pr } = await getOctokit().rest.pulls.get({
      owner: GITHUB_OWNER, repo: GITHUB_REPO, pull_number: item.number,
    });

    if (pr.head.repo && pr.head.repo.full_name !== `${ GITHUB_OWNER }/${ GITHUB_REPO }`) {
      // Ignore cross-repo PRs; they're not automatically generated.
      continue;
    }
    results.push(item);
  }

  return results;
}

async function determineUpdatesAvailable(): Promise<VersionComparison[]> {
  // load current versions of dependencies
  const currentVersions = await readDependencyVersions(DEP_VERSIONS_PATH);

  // get a list of dependencies' version comparisons
  const versionComparisons: VersionComparison[] = await Promise.all(dependencies.map(async(dependency) => {
    const availableVersions = await dependency.getAvailableVersions();

    const sortedVersions = availableVersions.sort((version1, version2) => {
      return dependency.rcompareVersions(version1, version2);
    });
    const latestVersion = sortedVersions[0];

    return {
      dependency,
      currentVersion: currentVersions[dependency.name as keyof DependencyVersions],
      latestVersion,
    };
  }));

  // filter comparisons down to the ones that need an update
  const updatesAvailable = versionComparisons.filter(({ dependency, currentVersion, latestVersion }) => {
    const comparison = dependency.rcompareVersions(currentVersion, latestVersion);

    if (comparison < 0) {
      console.warn(`Latest version ${ JSON.stringify(latestVersion) } of ${ dependency.name } is earlier than current version ${ JSON.stringify(currentVersion) }`);
    } else if (comparison === 0) {
      console.log(`${ dependency.name } is up to date.`);
    } else {
      console.log(`Can update ${ dependency.name } from ${ JSON.stringify(currentVersion) } to ${ JSON.stringify(latestVersion) }`);
    }

    return comparison > 0;
  });

  return updatesAvailable;
}

async function checkDependencies(): Promise<void> {
  // exit if there are unstaged changes
  git('update-index', '--refresh');
  if (git('diff-index', '--quiet', 'HEAD', '--')) {
    console.log('You have unstaged changes. Commit or stash them to manage dependencies.');

    return;
  }

  const updatesAvailable = await determineUpdatesAvailable();

  // reconcile dependencies that need an update with state of repo's PRs
  const needToCreatePR: VersionComparison[] = [];

  await Promise.all(updatesAvailable.map(async({ dependency, currentVersion, latestVersion }) => {
    // try to find PR for this combo of name, current version and latest version
    const prs = await getPulls(dependency.name);

    // we use title, rather than branch name, to filter pull requests
    // because branch name is not available from the search endpoint
    const title = getTitle(dependency.name, currentVersion, latestVersion);
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
        dependency, currentVersion, latestVersion,
      });
    }
  }));

  // create a branch for each version update, make changes, and make a PR from the branch
  for (const { dependency, currentVersion, latestVersion } of needToCreatePR) {
    const branchName = getBranchName(dependency.name, currentVersion, latestVersion);
    const commitMessage = `Bump ${ dependency.name } from ${ printable(currentVersion) } to ${ printable(latestVersion) }`;

    git('checkout', '-b', branchName, MAIN_BRANCH);
    const depVersions = await readDependencyVersions(DEP_VERSIONS_PATH);

    depVersions[dependency.name as keyof DependencyVersions] = latestVersion as string & AlpineLimaISOVersion;
    await writeDependencyVersions(DEP_VERSIONS_PATH, depVersions);
    git('add', DEP_VERSIONS_PATH);
    git('commit', '--signoff', '--message', commitMessage);
    git('push', '--force', `https://${ process.env.GITHUB_TOKEN }@github.com/${ GITHUB_OWNER }/${ GITHUB_REPO }`);
    await createDependencyBumpPR(dependency.name, currentVersion, latestVersion);
  }
}

(async() => {
  await checkDependencies();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
