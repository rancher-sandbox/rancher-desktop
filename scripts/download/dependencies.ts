import fs from 'fs';

import YAML from 'yaml';

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
  guestAgent = '';
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

  static async fromYAMLFile(path: string) {
    const rawContents = await fs.promises.readFile(path, 'utf-8');
    const obj = YAML.parse(rawContents);

    return new DependencyVersions(obj);
  }
}
