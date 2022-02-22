// This downloads the moby openAPI specification (for WSL-helper) and generates
// ./src/go/wsl-helper/pkg/dockerproxy/models/...

import fs from 'fs';
import path from 'path';
import buildUtils from '../lib/build-utils.mjs';
import { download } from '../lib/download.mjs';

// The version of the moby API we support
const mobyVersion = 'v1.41';

export default async function run() {
  const url = `https://raw.githubusercontent.com/moby/moby/master/docs/api/${ mobyVersion }.yaml`;
  const outPath = path.join(process.cwd(), 'src', 'go', 'wsl-helper', 'pkg', 'dockerproxy', 'swagger.yaml');

  await download(url, outPath, { access: fs.constants.W_OK });

  await buildUtils.spawn('go', 'generate', '-x', 'pkg/dockerproxy/generate.go', { cwd: path.join(process.cwd(), 'src', 'go', 'wsl-helper') });
  console.log('Moby API swagger models generated.');
}
