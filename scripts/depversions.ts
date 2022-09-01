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
]

async function checkDependencies(): Promise<void> {
  // load current versions of dependencies
  const currentVersions = DependencyVersions.fromYAMLFile(path.join('src', 'assets', 'dependencies.yaml'));
  
  // get the most recent versions of dependencies
  let latestVersions: Record<string, string | AlpineLimaISOVersion> = {};
  const promises = dependencies.map(async(dependency) => {
    return dependency.getLatestVersion().then(latestVersion => {
      latestVersions[dependency.name] = latestVersion;
    });
  })
  await Promise.all(promises);
  
  // print each current version next to latest version
  console.log('Dependency Name\tCurrent Version\tLatestVersion');
  for (const [depName, latestVersion] of Object.entries(latestVersions)) {
    const currentVersion = Reflect.get(currentVersions, depName);
    console.log(`${depName}\t${currentVersion}\t${latestVersion}`);
  }
}

// function buildDownloadContextFor(rawPlatform: DependencyPlatform, depVersions: DependencyVersions): DownloadContext {
//   const platform = rawPlatform === 'wsl' ? 'linux' : rawPlatform;
//   const resourcesDir = path.join(process.cwd(), 'resources');
//   const downloadContext: DownloadContext = {
//     versions:          depVersions,
//     dependencyPlaform: rawPlatform,
//     platform,
//     goPlatform:        platform === 'win32' ? 'windows' : platform,
//     isM1:              !!process.env.M1,
//     resourcesDir,
//     binDir:            path.join(resourcesDir, platform, 'bin'),
//     internalDir:       path.join(resourcesDir, platform, 'internal'),
//   };

//   fs.mkdirSync(downloadContext.binDir, { recursive: true });
//   fs.mkdirSync(downloadContext.internalDir, { recursive: true });

//   return downloadContext;
// }

checkDependencies().catch((e) => {
  console.error(e);
  process.exit(1);
});
