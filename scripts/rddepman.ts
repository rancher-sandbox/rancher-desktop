// A cross-platform script to check if newer versions of
// external dependencies are available.

import path from 'path';
import { spawnSync } from 'child_process';

import { LimaAndQemu, AlpineLimaISO } from 'scripts/dependencies/lima';
import { MobyOpenAPISpec } from 'scripts/dependencies/moby-openapi';
import * as tools from 'scripts/dependencies/tools';
import { WSLDistro, HostResolverHost, HostResolverPeer } from 'scripts/dependencies/wsl';
import { DependencyVersions, readDependencyVersions, writeDependencyVersions, Dependency, AlpineLimaISOVersion, getOctokit } from 'scripts/lib/dependencies';

const MAIN_BRANCH = 'main';
const GITHUB_OWNER = 'rancher-sandbox';
const GITHUB_REPO = 'rancher-desktop;'

type VersionComparison = {
  name: string;
  currentVersion: string | AlpineLimaISOVersion;
  latestVersion: string | AlpineLimaISOVersion;
}

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
  new HostResolverHost(),
  new HostResolverPeer(),
  new MobyOpenAPISpec(),
];

function git(...args: string[]): number | null {
  const result = spawnSync('git', args);
  if (result.error) {
    throw result.error;
  }
  return result.status;
}

async function createDependencyBumpPR(name: string, currentVersion: string | AlpineLimaISOVersion, latestVersion: string | AlpineLimaISOVersion): Promise<void> {
  const title = `rddepman: bump ${ name } from ${ currentVersion } to ${ latestVersion }`;
  const branchName = `rddepman-bump-${ name }-from-${ currentVersion }-to-${ latestVersion }`;
  await getOctokit().rest.pulls.create({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    title,
    base: MAIN_BRANCH,
    head: branchName
  })
}

async function checkDependencies(): Promise<void> {
  // load current versions of dependencies
  const depVersionsPath = path.join('src', 'assets', 'dependencies.yaml');
  const currentVersions = await readDependencyVersions(depVersionsPath);

  // Get a list of dependencies for which:
  // a) current version !== latest version
  // b) there is not already a PR (open or closed) to perform this exact bump
  const versionUpdates: VersionComparison[] = [];
  const promises = dependencies.map(async(dependency) => {
    const latestVersion = await dependency.getLatestVersion();
    const currentVersion = currentVersions[dependency.name as keyof DependencyVersions];
    const name = dependency.name;

    if (JSON.stringify(currentVersion) === JSON.stringify(latestVersion)) {
      console.log(`Dependency "${ name }" is at latest version "${ JSON.stringify(currentVersion) }".`)
      return;
    }

    // try to find PR for this combo of name, current version and latest version
    const branchName = `rddepman-bump-${ name }-from-${ currentVersion }-to-${ latestVersion }`;
    try {
      const response = await getOctokit().rest.pulls.list({owner: GITHUB_OWNER, repo: GITHUB_REPO, base: branchName})
      const prs = response.data;
      if (prs.length === 0) {
      } else if (prs.length === 1) {
        console.log(`Found PR that bumps dependency "${ name }" from "${ currentVersion }" to "${ latestVersion }".`);
      } else {
        throw new Error(`Found multiple branches that bump dependency "${ name }" from "${ currentVersion }" to "${ latestVersion }".`);
      }
    } catch (error: any) {
      if (error.status === 404) {
        console.log(`Could not find PR that bumps dependency "${ name }" from "${ currentVersion }" to "${ latestVersion }". Creating...`);
        versionUpdates.push({name, currentVersion, latestVersion});
      } else {
        throw error;
      }
    }
  });

  await Promise.all(promises);

  // exit if there are unstaged changes
  git('update-index', '--refresh');
  if (git('diff-index', '--quiet', 'HEAD', '--')) {
    console.log('You have unstaged changes. Commit or stash them to manage dependencies.');
    return;
  }

  // create a branch for each version update, make changes, and make a PR from the branch
  for (const {name, currentVersion, latestVersion} of versionUpdates) {
    const branchName = `rddepman-bump-${ name }-from-${ currentVersion }-to-${ latestVersion }`;
    const commitMessage = `Bump ${ name } from ${ currentVersion } to ${ latestVersion }`;

    git('checkout', '-b', branchName, MAIN_BRANCH);
    const depVersions = await readDependencyVersions(depVersionsPath);
    depVersions[name as keyof DependencyVersions] = latestVersion as string & AlpineLimaISOVersion;
    await writeDependencyVersions(depVersionsPath, depVersions);
    git('add', '.');
    git('commit', '-s', '-m', commitMessage);
    git('push');
    await createDependencyBumpPR(name, currentVersion, latestVersion);
  }
}

checkDependencies().catch((e) => {
  console.error(e);
  process.exit(1);
});
