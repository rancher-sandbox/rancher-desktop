import fs from 'fs';
import path from 'path';

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
    const baseUrl = `https://raw.githubusercontent.com/${ this.githubOwner }/${ this.githubRepo }/master/docs/api`;
    const url = `${ baseUrl }/v${ context.versions.mobyOpenAPISpec }.yaml`;
    const outPath = path.join(process.cwd(), 'src', 'go', 'wsl-helper', 'pkg', 'dockerproxy', 'swagger.yaml');

    await download(url, outPath, { access: fs.constants.W_OK });

    // As of 1.48 they have an example of an uint64 that's at 2^64-1 (i.e. max),
    // but the YAML parser uses strconv.ParseInt() which only takes int64.  This
    // causes issues with `go generate`.  Work around the issue by replacing the
    // example string, which we don't care about anyway.
    const originalContents = await fs.promises.readFile(outPath, 'utf-8');
    const modifiedContents = originalContents.replace('example: 18446744073709551615', 'example: 9223372036854775807');

    await fs.promises.writeFile(outPath, modifiedContents, 'utf-8');

    await simpleSpawn('go', ['generate', '-x', 'pkg/dockerproxy/generate.go'], { cwd: path.join(process.cwd(), 'src', 'go', 'wsl-helper') });
    console.log('Moby API swagger models generated.');
  }

  async getAvailableVersions(): Promise<string[]> {
    // get list of files in repo directory
    const githubPath = 'docs/api';
    const args = {
      owner: this.githubOwner, repo: this.githubRepo, path: githubPath,
    };
    const response = await getOctokit().rest.repos.getContent(args);
    const fileObjs = response.data as Partial<{name: string}>[];
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
