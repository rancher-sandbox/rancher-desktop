// A cross-platform script to check if newer versions of
// external dependencies are available.

// import { downloadLimaAndQemu, downloadAlpineLimaISO } from 'scripts/dependencies/lima';
// import { downloadMobyOpenAPISpec } from 'scripts/dependencies/moby-openapi';
import * as tools from 'scripts/dependencies/tools';
// import { downloadWSLDistro, downloadHostResolverHost, downloadHostResolverPeer } from 'scripts/dependencies/wsl';
import { DependencyVersions, Dependency } from 'scripts/lib/dependencies';

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
  // tools.ECRCredHelper,
  // LimaAndQemu,
  // AlpineLimaISO,
  // WSLDistro,
  // HostResolverHost,
  // HostResolverPeer,
  // MobyOpenAPISpec,
]

async function checkDependencies(): Promise<void> {
  // load current versions of dependencies
  const currentVersions = await DependencyVersions.fromYAMLFile('dependencies.yaml');
  
  // get the most recent versions of dependencies
  const latestVersions: Record<string, string> = {};
  for (const dependency of dependencies) {
    latestVersions[dependency.name] = await dependency.getLatestVersion();
  }
  // const promises = dependencies.map(dependency => {
  //   dependency.getLatestVersion().then(latestVersion => {
  //     latestVersions[dependency.name] = latestVersion;
  //     console.log(`dependency "${dependency.name}" came through as version "${latestVersion}"`);
  //     console.log(latestVersions);
  //   });
  // })
  // await Promise.all(promises);
  
  // print each current version next to latest version
  for (const [depName, latestVersion] of Object.entries(latestVersions)) {
    const currentVersion = Reflect.get(currentVersions, depName);currentVersion
    console.log(`${depName}\t${currentVersion}\t${latestVersion}`);
  }
  
  console.log(currentVersions);
  console.log(latestVersions);
  console.log('completed');
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
