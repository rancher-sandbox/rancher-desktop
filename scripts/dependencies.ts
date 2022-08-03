import DependencyVersions from './download/dependencies';

async function runScripts(): Promise<void> {
  const deps = await DependencyVersions.fromJSONFile('dependencies.json');
  console.log(deps);
}

runScripts().then(() => {
  console.log('done');
})
