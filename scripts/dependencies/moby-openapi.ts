import fs from 'fs';
import path from 'path';

import _ from 'lodash';
import yaml from 'yaml';

import { download } from '../lib/download';

import { DownloadContext, getOctokit, VersionedDependency, GlobalDependency } from 'scripts/lib/dependencies';
import { simpleSpawn } from 'scripts/simple_process';

// This downloads the moby openAPI specification (for WSL-helper) and generates
// ./src/go/wsl-helper/pkg/dockerproxy/models/...
export class MobyOpenAPISpec extends GlobalDependency(VersionedDependency) {
  readonly name = 'mobyOpenAPISpec';
  readonly githubOwner = 'moby';
  readonly githubRepo = 'moby';
  readonly releaseFilter = 'custom';

  async download(context: DownloadContext): Promise<void> {
    const baseUrl = `https://raw.githubusercontent.com/${ this.githubOwner }/${ this.githubRepo }/master/api/docs`;
    const url = `${ baseUrl }/v${ context.versions.mobyOpenAPISpec }.yaml`;
    const outPath = path.join(process.cwd(), 'src', 'go', 'wsl-helper', 'pkg', 'dockerproxy', 'swagger.yaml');
    const modifiedPath = path.join(path.dirname(outPath), 'swagger-modified.yaml');

    await download(url, outPath, { access: fs.constants.W_OK });

    // We may need compatibility fixes from time to time as the upstream swagger
    // configuration is manually maintained and needs fixups to work.
    const contents = yaml.parse(await fs.promises.readFile(outPath, 'utf-8'), { intAsBigInt: true });

    // go-swagger gets confused when multiple things have the same name; this
    // collides with definitions.Config
    if (contents.definitions?.Plugin?.properties?.Config?.['x-go-name'] === 'Config') {
      contents.definitions.Plugin.properties.Config['x-go-name'] = 'PluginConfig';
    }
    // Same as above; various Plugin* things collide with the non-plugin versions.
    for (const key of Object.keys(contents.definitions ?? {}).filter(k => /^Plugin./.test(k))) {
      delete contents.definitions[key]?.['x-go-name'];
    }

    // Moby is starting to add `x-go-type` annotations to the spec; however,
    // none of the types implement validation, and some types are not actually
    // defined in the file.  Override them here.
    (function checkTypes(obj: object, prefix = '') {
      for (const [k, v] of Object.entries(obj)) {
        if (k === 'x-go-type') {
          const pkg = v.import?.package ?? '';
          if (!pkg && /^[A-Z]/.test(v.type)) {
            // If a type is exported but has no package, it's undefined.
            console.log(`\x1B[34;1m${ prefix }\x1B[22m has invalid type \x1B[1m${ v.type }\x1B[22m, removing.\x1B[0m`);
            delete (obj as any)[k];
          } else {
            // For all other types, skip validation.
            console.log(`\x1B[34;1m${ prefix }\x1B[22m has type \x1B[1m${ pkg }.${ v.type }\x1B[22m, disabling validation.\x1B[0m`);
            _.set(v, 'hints.noValidation', true);
          }
        } else if (_.isPlainObject(v)) {
          checkTypes(v, `${ prefix }.${ k }`.replace(/^\./, ''));
        } else if (Array.isArray(v)) {
          for (const [i, element] of Object.entries(v)) {
            checkTypes(element, `${ prefix }[${ i }]`);
          }
        }
      }
    })(contents);

    await fs.promises.writeFile(modifiedPath, yaml.stringify(contents), 'utf-8');

    await simpleSpawn('go', ['generate', '-x', 'pkg/dockerproxy/generate.go'], { cwd: path.join(process.cwd(), 'src', 'go', 'wsl-helper') });
    console.log('Moby API swagger models generated.');
  }

  async getAvailableVersions(): Promise<string[]> {
    // get list of files in repo directory
    const githubPath = 'api/docs';
    const args = {
      owner: this.githubOwner, repo: this.githubRepo, path: githubPath,
    };
    const response = await getOctokit().rest.repos.getContent(args);
    const fileObjs = response.data as Partial<{ name: string }>[];
    const allFiles = fileObjs.map(fileObj => fileObj.name);

    // extract versions from file names and convert to valid semver format
    const versions = [];

    for (const fileName of allFiles) {
      const match = fileName?.match(/^v([0-9]+\.[0-9]+)\.yaml$/);

      if (match) {
        // to compare with semver we need to add .0 onto the end
        versions.push(match[1]);
      }
    }

    return versions;
  }
}
