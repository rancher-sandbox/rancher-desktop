import DependencyVersions from './download/dependencies';
import downloadDependencies from './download/tools';

async function runScripts(): Promise<void> {
  // load desired versions of dependencies
  const depVersions = await DependencyVersions.fromJSONFile('dependencies.json');
  console.log(deps);
  
  // download the desired versions
  await downloadDependencies(depVersions): Promise<void>;
}

runScripts().then(() => {
  console.log('done');
})
