import path from 'path';
import paths from '@/utils/paths';
import * as YAML from 'yaml';
import fs from 'fs';

export async function getDependencyVersion(key: string): Promise<string> {
  const dependenciesPath = path.join(paths.resources, 'dependencies.yaml');
  const rawVersions = await fs.promises.readFile(dependenciesPath, 'utf-8');
  const dependencyVersions = YAML.parse(rawVersions);
  const version = dependencyVersions[key];
  if (typeof version !== 'string') {
     throw new Error(`Key "${ key }" was not found in dependency version file or was of wrong type`);
  }
  return version;
}
