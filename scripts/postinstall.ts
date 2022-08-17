import { execFileSync } from 'child_process';
import os from 'os';

import DependencyVersions from 'scripts/download/dependencies';
import downloadLima from 'scripts/download/lima';
import downloadMobyOpenAPISpec from 'scripts/download/moby-openapi';
import downloadDependencies from 'scripts/download/tools';
import downloadWSL from 'scripts/download/wsl';

async function runScripts(): Promise<void> {
  // load desired versions of dependencies
  const depVersions = await DependencyVersions.fromYAMLFile('dependencies.yaml');

  // download the desired versions
  await downloadMobyOpenAPISpec();
  switch (os.platform()) {
  case 'linux':
    await downloadDependencies('linux', depVersions);
    await downloadLima();
    break;
  case 'darwin':
    await downloadDependencies('darwin', depVersions);
    await downloadLima();
    break;
  case 'win32':
    await downloadDependencies('win32', depVersions);
    await downloadDependencies('wsl', depVersions);
    await downloadWSL();
    break;
  }
}

runScripts().then(() => {
  execFileSync('node', ['node_modules/electron-builder/out/cli/cli.js', 'install-app-deps'], { stdio: 'inherit' });
})
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
