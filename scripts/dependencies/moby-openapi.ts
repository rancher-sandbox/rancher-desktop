import fs from 'fs';
import path from 'path';

import _ from 'lodash';
import yaml from 'yaml';

import { download } from '../lib/download';

import {
  DownloadContext,
  downloadAndHash,
  getOctokit,
  GlobalDependency,
  lookupChecksum,
  MobyOpenAPISpecVersion,
  Sha256Checksum,
  VersionedDependency,
} from '@/scripts/lib/dependencies';
import { simpleSpawn } from '@/scripts/simple_process';

// This downloads the moby openAPI specification (for WSL-helper) and generates
// ./src/go/wsl-helper/pkg/dockerproxy/models/...
export class MobyOpenAPISpec extends GlobalDependency(VersionedDependency) {
  readonly name = 'mobyOpenAPISpec';
  readonly githubOwner = 'moby';
  readonly githubRepo = 'moby';
  readonly releaseFilter = 'custom';

  async download(context: DownloadContext): Promise<void> {
    const { apiVersion, commit } = context.dependencies.mobyOpenAPISpec.version;

    if (!apiVersion || !/^[0-9a-f]{40}$/i.test(commit ?? '')) {
      throw new Error(`mobyOpenAPISpec entry must specify apiVersion and a 40-char commit SHA; got ${ JSON.stringify({ apiVersion, commit }) }`);
    }
    const baseUrl = `https://raw.githubusercontent.com/${ this.githubOwner }/${ this.githubRepo }/${ commit }/api/docs`;
    const fileName = `v${ apiVersion }.yaml`;
    const url = `${ baseUrl }/${ fileName }`;
    const outPath = path.join(process.cwd(), 'src', 'go', 'wsl-helper', 'pkg', 'dockerproxy', 'swagger.yaml');
    const modifiedPath = path.join(path.dirname(outPath), 'swagger-modified.yaml');

    await download(url, outPath, {
      expectedChecksum: lookupChecksum(context, this.name, fileName),
      access:           fs.constants.W_OK,
    });

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

  async getChecksums(version: MobyOpenAPISpecVersion): Promise<Record<string, Sha256Checksum>> {
    // version.commit pins the URL to an immutable git object; raw.githubusercontent.com
    // serves no sidecar to cross-check.  rddepman records the digest we observe
    // at bump time as the source of truth.
    const fileName = `v${ version.apiVersion }.yaml`;
    const url = `https://raw.githubusercontent.com/${ this.githubOwner }/${ this.githubRepo }/${ version.commit }/api/docs/${ fileName }`;

    return { [fileName]: await downloadAndHash(url) };
  }

  // Returns each historical apiVersion with a placeholder commit;
  // latestVersion resolves the real commit only for the winner.
  // Resolving a commit per entry would burn one listCommits call per
  // historical version for a field that rcompareVersions ignores.
  async getAvailableVersions(): Promise<MobyOpenAPISpecVersion[]> {
    type Candidate = Pick<MobyOpenAPISpecVersion, 'apiVersion'>;
    const args = {
      owner: this.githubOwner, repo: this.githubRepo, path: 'api/docs',
    };
    const response = await getOctokit().rest.repos.getContent(args);
    const fileObjs = response.data as Partial<{ name: string }>[];
    const candidates: Candidate[] = [];

    for (const fileObj of fileObjs) {
      const match = fileObj.name?.match(/^v([0-9]+\.[0-9]+)\.yaml$/);

      if (match) {
        candidates.push({ apiVersion: match[1] });
      }
    }

    // Materialize the placeholder at the return boundary.  The base class
    // sorts via rcompareVersions, which reads apiVersion only; the
    // latestVersion override resolves the real commit on the winner.
    return candidates.map(c => ({ ...c, commit: '' }));
  }

  override get latestVersion(): Promise<MobyOpenAPISpecVersion> {
    return (async() => {
      const winner = await super.latestVersion as MobyOpenAPISpecVersion;

      return { ...winner, commit: await this.latestCommitForApiVersion(winner.apiVersion) };
    })();
  }

  // Compare the API version only.  The pinned commit makes the install
  // URL immutable, so a new commit on the same apiVersion cannot change
  // what postinstall fetches and does not warrant an auto-bump.  To
  // adopt a new commit, edit dependencies.yaml manually.
  rcompareVersions(version1: MobyOpenAPISpecVersion, version2: MobyOpenAPISpecVersion): -1 | 0 | 1 {
    return super.rcompareVersions(version1.apiVersion, version2.apiVersion);
  }

  // Resolves the latest commit on the default branch that touched
  // `api/docs/v${ apiVersion }.yaml`.  rddepman pins this SHA in
  // `dependencies.yaml` so install-time downloads target an immutable URL.
  protected async latestCommitForApiVersion(apiVersion: string): Promise<string> {
    const { data } = await getOctokit().rest.repos.listCommits({
      owner:    this.githubOwner,
      repo:     this.githubRepo,
      path:     `api/docs/v${ apiVersion }.yaml`,
      per_page: 1,
    });

    if (!data.length) {
      throw new Error(`No commits found for api/docs/v${ apiVersion }.yaml`);
    }

    return data[0].sha;
  }
}
