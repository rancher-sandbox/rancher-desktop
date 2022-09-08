// A cross-platform script to check if newer versions of
// external dependencies are available.

import path from 'path';
import { spawnSync, SpawnSyncReturns } from 'child_process';

import { LimaAndQemu, AlpineLimaISO } from 'scripts/dependencies/lima';
import { MobyOpenAPISpec } from 'scripts/dependencies/moby-openapi';
import * as tools from 'scripts/dependencies/tools';
import { WSLDistro, HostResolverHost, HostResolverPeer } from 'scripts/dependencies/wsl';
import { DependencyVersions, Dependency, AlpineLimaISOVersion, getOctokit } from 'scripts/lib/dependencies';

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

function git(...args: string[]): void {
  const result = spawnSync('git', args);
  if (result.error) {
    throw result.error;
  }
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
  const currentVersions = DependencyVersions.fromYAMLFile(path.join('src', 'assets', 'dependencies.yaml'));

  // Get a list of dependencies for which:
  // a) current version !== latest version
  // b) there is not already a PR (open or closed) to perform this exact bump
  const versionUpdates: VersionComparison[] = [];
  const promises = dependencies.map(async(dependency) => {
    const latestVersion = await dependency.getLatestVersion();
    const currentVersion = currentVersions[dependency.name as keyof DependencyVersions];
    const name = dependency.name;

    if (JSON.stringify(currentVersion) !== JSON.stringify(latestVersion)) {
      // try to find PR for this combo of name, current version and latest version
      const branchName = `rddepman-bump-${ name }-from-${ currentVersion }-to-${ latestVersion }`;
      const response = await getOctokit().rest.pulls.list({owner: GITHUB_OWNER, repo: GITHUB_REPO, base: branchName})
      const prs = response.data;

      // act depending on whether PR exists
      if (prs.length === 0) {
        console.log(`Could not find PR that bumps dependency "${ name }" from "${ currentVersion }" to "${ latestVersion }"`);
        versionUpdates.push({name, currentVersion, latestVersion});
      } else if (prs.length === 1) {
        console.log(`Found PR that bumps dependency "${ name }" from "${ currentVersion }" to "${ latestVersion }"`);
      } else {
        throw new Error(`Found multiple branches that bump dependency "${ name }" from "${ currentVersion }" to "${ latestVersion }"`);
      }
    }
  });

  await Promise.all(promises);

  // create a branch for each version update, make changes, and make a PR from the branch
  for (const {name, currentVersion, latestVersion} of versionUpdates) {
    const branchName = `rddepman-bump-${ name }-from-${ currentVersion }-to-${ latestVersion }`;
    const commitMessage = `Bump ${ name } from ${ currentVersion } to ${ latestVersion }`;

    git('checkout', '-b', branchName, MAIN_BRANCH);
    // make changes
    git('add', '.');
    git('commit', '-s', '-m', commitMessage);
    git('push');
    git('branch', '-D', branchName);
    await createDependencyBumpPR(name, currentVersion, latestVersion);
  }
}

checkDependencies().catch((e) => {
  console.error(e);
  process.exit(1);
});
