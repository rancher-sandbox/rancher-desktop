// A cross-platform script to check if newer versions of
// external dependencies are available.

import path from 'path';

import { LimaAndQemu, AlpineLimaISO } from 'scripts/dependencies/lima';
import { MobyOpenAPISpec } from 'scripts/dependencies/moby-openapi';
import * as tools from 'scripts/dependencies/tools';
import { WSLDistro, HostResolverHost, HostResolverPeer } from 'scripts/dependencies/wsl';
import { DependencyVersions, Dependency, AlpineLimaISOVersion } from 'scripts/lib/dependencies';

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
  const latestVersions: Record<string, string | AlpineLimaISOVersion> = {};
  const promises = dependencies.map(async(dependency) => {
    latestVersions[dependency.name] = await dependency.getLatestVersion();
  });

  await Promise.all(promises);

  const versionComparisons = [];

  for (const [name, latestVersion] of Object.entries(latestVersions)) {
    const currentVersion = currentVersions[name as keyof DependencyVersions];

    versionComparisons.push({
      name,
      currentVersion,
      latestVersion,
    });
  }
  console.log(JSON.stringify(versionComparisons));
}

checkDependencies().catch((e) => {
  console.error(e);
  process.exit(1);
});
