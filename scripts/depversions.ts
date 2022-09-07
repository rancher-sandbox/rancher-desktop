// A cross-platform script to check if newer versions of
// external dependencies are available.

import path from 'path';

import { LimaAndQemu, AlpineLimaISO } from 'scripts/dependencies/lima';
import { MobyOpenAPISpec } from 'scripts/dependencies/moby-openapi';
import * as tools from 'scripts/dependencies/tools';
import { WSLDistro, HostResolverHost, HostResolverPeer } from 'scripts/dependencies/wsl';
import { DependencyVersions, Dependency, AlpineLimaISOVersion, getOctokit } from 'scripts/lib/dependencies';

type VersionComparison<Type extends string | AlpineLimaISOVersion> = {
  name: string;
  currentVersion: Type;
  latestVersion: Type;
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

async function checkDependencies(): Promise<void> {
  // load current versions of dependencies
  const currentVersions = DependencyVersions.fromYAMLFile(path.join('src', 'assets', 'dependencies.yaml'));

  // get the most recent versions of dependencies
  const promises = dependencies.map(async(dependency) => {
    const latestVersion = await dependency.getLatestVersion();
    const currentVersion = currentVersions[dependency.name as keyof DependencyVersions];
    const name = dependency.name;

    if (JSON.stringify(currentVersion) === JSON.stringify(latestVersion)) {
      console.log(`Current version and latest version for dependency "${ name }" are equal; doing nothing`);
      return;
    }

    // try to find PR for this combo of name, current version and latest version
    const branchName = `rddepman-bump-${ name }-from-${ currentVersion }-to-${ latestVersion }`;
    const response = await getOctokit().rest.pulls.list({owner: 'rancher-sandbox', repo: 'rancher-desktop', base: branchName})
    const prs = response.data;

    // act depending on whether PR exists
    if (prs.length === 0) {
      console.log(`Creating PR to bump dependency "${ name }" from "${ currentVersion }" to "${ latestVersion }"`);
    } else if (prs.length === 1) {
      console.log(`Found PR that bumps dependency "${ name }" from "${ currentVersion }" to "${ latestVersion }"; doing nothing`)
    } else {
      throw new Error(`Found multiple branches that bump dependency "${ name }" from "${ currentVersion }" to "${ latestVersion }"`);
    }
  });

  await Promise.all(promises);
}

checkDependencies().catch((e) => {
  console.error(e);
  process.exit(1);
});
