import fs from 'fs';

export default class DependencyVersions {
  alpineLimaISO: string = "";
  WSLDistro: string = "";
  kuberlr: string = "";
  helm: string = "";
  docker: string = "";
  dockerBuildx: string = "";
  dockerCompose: string = "";
  trivy: string = "";
  steve: string = "";
  dockerProvidedCredentialHelpers: string = "";
  ECRCredenialHelper: string = "";
  hostResolver: string = "";
  
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
    const rawContents = await fs.promises.readFile(path, 'utf8')
    const obj = JSON.parse(rawContents);
    return new DependencyVersions(obj);
  }
}