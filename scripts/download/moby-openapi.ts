// This downloads the moby openAPI specification (for WSL-helper) and generates
// ./src/go/wsl-helper/pkg/dockerproxy/models/...

import fs from 'fs';
import path from 'path';

import { DownloadContext } from 'scripts/lib/dependencies';

import buildUtils from '../lib/build-utils';
import { download } from '../lib/download';

export async function downloadMobyOpenAPISpec(context: DownloadContext): Promise<void> {
  const baseUrl = 'https://raw.githubusercontent.com/moby/moby/master/docs/api';
  const url = `${ baseUrl }/${ context.versions.mobyOpenAPISpec }.yaml`;
  const outPath = path.join(process.cwd(), 'src', 'go', 'wsl-helper', 'pkg', 'dockerproxy', 'swagger.yaml');

  await download(url, outPath, { access: fs.constants.W_OK });

  await buildUtils.spawn('go', 'generate', '-x', 'pkg/dockerproxy/generate.go', { cwd: path.join(process.cwd(), 'src', 'go', 'wsl-helper') });
  console.log('Moby API swagger models generated.');
}
