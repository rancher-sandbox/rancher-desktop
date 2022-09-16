// A cross-platform script to check if newer versions of
// external dependencies are available.

import { spawnSync } from 'child_process';
import path from 'path';

import { LimaAndQemu, AlpineLimaISO } from 'scripts/dependencies/lima';
import { MobyOpenAPISpec } from 'scripts/dependencies/moby-openapi';
import * as tools from 'scripts/dependencies/tools';
import { WSLDistro, HostResolverHost, HostResolverPeer } from 'scripts/dependencies/wsl';
import {
  DependencyVersions, readDependencyVersions, writeDependencyVersions, Dependency, AlpineLimaISOVersion, getOctokit,
} from 'scripts/lib/dependencies';

const MAIN_BRANCH = 'main';
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'rancher-sandbox';
const GITHUB_REPO = process.env.GITHUB_REPO || 'rancher-desktop';

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

function printable(version: string | AlpineLimaISOVersion): string {
  return typeof version === 'string' ? version : version.isoVersion;
}

function getBranchName(name: string, currentVersion: string | AlpineLimaISOVersion, latestVersion: string | AlpineLimaISOVersion): string {
  return `rddepman/${ name }/${ printable(currentVersion) }-to-${ printable(latestVersion) }`;
}

function compareVersions(version1: string | AlpineLimaISOVersion, version2: string | AlpineLimaISOVersion): boolean {
  if (typeof version1 === 'string' && typeof version2 === 'string') {
    return version1 === version2;
  } else if (typeof version1 !== 'string' && typeof version2 !== 'string') {
    return version1.isoVersion === version2.isoVersion && version1.alpineVersion === version2.alpineVersion;
  }
  throw new Error('Types of version1 and version2 differ.');
}

async function createDependencyBumpPR(name: string, currentVersion: string | AlpineLimaISOVersion, latestVersion: string | AlpineLimaISOVersion): Promise<void> {
  const title = `rddepman: bump ${ name } from ${ printable(currentVersion) } to ${ printable(latestVersion) }`;
  const branchName = getBranchName(name, currentVersion, latestVersion);

  await getOctokit().rest.pulls.create({
    owner: GITHUB_OWNER,
    repo:  GITHUB_REPO,
    title,
    base:  MAIN_BRANCH,
    head:  branchName,
  });
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

    if (compareVersions(currentVersion, latestVersion)) {
      console.log(`Dependency "${ name }" is at latest version "${ printable(currentVersion) }".`);

      return;
    }

    // try to find PR for this combo of name, current version and latest version
    const branchName = getBranchName(name, currentVersion, latestVersion);

    const response = await getOctokit().rest.pulls.list({
      owner: GITHUB_OWNER, repo: GITHUB_REPO, head: `${ GITHUB_OWNER }:${ branchName }`, state: 'all',
    });
    const prs = response.data;

    if (prs.length === 0) {
      console.log(`Could not find PR that bumps dependency "${ name }" from "${ printable(currentVersion) }" to "${ printable(latestVersion) }". Creating...`);
      versionUpdates.push({
        name, currentVersion, latestVersion,
      });
    } else if (prs.length === 1) {
      console.log(`Found PR that bumps dependency "${ name }" from "${ printable(currentVersion) }" to "${ printable(latestVersion) }".`);
    } else if (prs.length > 1) {
      throw new Error(`Found multiple branches that bump dependency "${ name }" from "${ printable(currentVersion) }" to "${ printable(latestVersion) }".`);
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
  for (const { name, currentVersion, latestVersion } of versionUpdates) {
    const branchName = getBranchName(name, currentVersion, latestVersion);
    const commitMessage = `Bump ${ name } from ${ currentVersion } to ${ latestVersion }`;

    git('checkout', '-b', branchName, MAIN_BRANCH);
    const depVersions = await readDependencyVersions(depVersionsPath);

    depVersions[name as keyof DependencyVersions] = latestVersion as string & AlpineLimaISOVersion;
    await writeDependencyVersions(depVersionsPath, depVersions);
    git('add', '.');
    git('commit', '--signoff', '--message', commitMessage);
    git('push');
    await createDependencyBumpPR(name, currentVersion, latestVersion);
  }
}

checkDependencies().catch((e) => {
  console.error(e);
  process.exit(1);
});
