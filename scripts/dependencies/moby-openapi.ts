import fs from 'fs';
import path from 'path';

import semver from 'semver';

import { download } from '../lib/download';

import { spawnFile } from '@/utils/childProcess';
import { DownloadContext, Dependency, getOctokit } from 'scripts/lib/dependencies';

// This downloads the moby openAPI specification (for WSL-helper) and generates
// ./src/go/wsl-helper/pkg/dockerproxy/models/...
export class MobyOpenAPISpec implements Dependency {
  name = 'mobyOpenAPISpec';
  githubOwner = 'moby';
  githubRepo = 'moby';

  async download(context: DownloadContext): Promise<void> {
    const baseUrl = `https://raw.githubusercontent.com/${ this.githubOwner }/${ this.githubRepo }/master/docs/api`;
    const url = `${ baseUrl }/v${ context.versions.mobyOpenAPISpec }.yaml`;
    const outPath = path.join(process.cwd(), 'src', 'go', 'wsl-helper', 'pkg', 'dockerproxy', 'swagger.yaml');

    await download(url, outPath, { access: fs.constants.W_OK });

    await spawnFile('go', ['generate', '-x', 'pkg/dockerproxy/generate.go'], { cwd: path.join(process.cwd(), 'src', 'go', 'wsl-helper'), stdio: 'inherit' });
    console.log('Moby API swagger models generated.');
  }

  async getLatestVersion(): Promise<string> {
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
        versions.push(`${ match[1] }.0`);
      }
    }

    // get the latest version
    const latestSemverVersion = versions.reduce((previous: string, current: string) => {
      return semver.lt(previous, current) ? current : previous;
    });

    return latestSemverVersion.split('.').slice(0, 2).join('.');
  }
}
