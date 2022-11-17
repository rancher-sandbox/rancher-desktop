import fs from 'fs';
import path from 'path';

import { Dependency, DownloadContext, GithubVersionGetter } from '../lib/dependencies';
import { download } from '../lib/download';

import { spawnFile } from '@pkg/utils/childProcess';

/**
 * Wix downloads the latest build of WiX3.
 */
export class Wix extends GithubVersionGetter implements Dependency {
  readonly name = 'wix';

  // Wix4 is packaged really oddly (involves NuGet), and while there's a sketchy
  // build in github.com/electron-userland/electron-builder-binaries it's rather
  // outdated (and has since-fixed bugs).
  readonly githubOwner = 'wixtoolset';
  readonly githubRepo = 'wix3';

  async download(context: DownloadContext): Promise<void> {
    // WiX doesn't appear to believe in checksum files...

    const hostDir = path.join(context.resourcesDir, 'host');
    const wixDir = path.join(hostDir, 'wix');
    const archivePath = path.join(hostDir, `${ context.versions.wix }.zip`);
    const url = `https://github.com/wixtoolset/wix3/releases/download/${ context.versions.wix }/wix311-binaries.zip`;

    await fs.promises.mkdir(wixDir, { recursive: true });
    await download(url, archivePath);
    await spawnFile('unzip', ['-o', archivePath, '-d', wixDir], { cwd: wixDir, stdio: 'inherit' });
  }
}
