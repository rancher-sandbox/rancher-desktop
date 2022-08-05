import fs from 'fs';

export default class DependencyVersions {
  alpineLimaISO = '';
  WSLDistro = '';
  kuberlr = '';
  helm = '';
  dockerCLI = '';
  dockerBuildx = '';
  dockerCompose = '';
  trivy = '';
  steve = '';
  rancherDashboard = '';
  dockerProvidedCredentialHelpers = '';
  ECRCredenialHelper = '';
  hostResolver = '';

  constructor(inputObject: any) {
    for (const key in this) {
      const inputValue = inputObject[key];

      if (!inputValue) {
        throw new Error(`key "${ key }" from input object is falsy`);
      }
      Reflect.set(this, key, inputValue);
    }
  }

  static async fromJSONFile(path: string) {
    const rawContents = await fs.promises.readFile(path, 'utf8');
    const obj = JSON.parse(rawContents);

    return new DependencyVersions(obj);
  }
}
