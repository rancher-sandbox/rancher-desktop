import fs from 'node:fs';
import path from 'node:path';

import { cartesian } from '@/scripts/dependencies/tools';
import {
  AssetPlatform,
  assetChecksum,
  DependencyAsset,
  DownloadContext,
  downloadAndHash,
  GlobalDependency,
  GoArch,
  selectAssets,
  VersionedDependency,
} from '@/scripts/lib/dependencies';
import { download } from '@/scripts/lib/download';
import { simpleSpawn } from '@/scripts/simple_process';

/** Electron names its archives with Node's platform/arch, not Go's. */
const GO_PLATFORM: Record<'darwin' | 'linux' | 'win32', AssetPlatform> = { darwin: 'darwin', linux: 'linux', win32: 'windows' };
const GO_ARCH: Record<'x64' | 'arm64', GoArch> = { x64: 'amd64', arm64: 'arm64' };

/**
 * Download pre-build Electron binaries from the official sources.
 */
export class Electron extends GlobalDependency(VersionedDependency) {
  readonly name = 'electron';
  readonly githubOwner = 'electron';
  readonly githubRepo = 'electron';

  private getBaseURL(version: string): string {
    return `https://github.com/${ this.githubOwner }/${ this.githubRepo }/releases/download/v${ version }/`;
  }

  // Electron's assets are pinned to the package.json version, which a
  // regenerate cannot resolve; rddepman bumps it instead.
  readonly regenerable = false;

  private get version(): Promise<string> {
    return import('electron/package.json').then(({ version }) => version);
  }

  async download(context: DownloadContext): Promise<void> {
    // We don't actually use the version or checksums we recorded; instead, we
    // use the ones embedded from the electron package.  This is to avoid errors
    // running `yarn install` in the dependabot PRs where `package.json`
    // has been updated but before the next rddepman run (where we update the
    // checksums).  However, we can at least check if the versions match, and if
    // yes, that the checksum is correct.
    const arch = context.isM1 ? 'arm64' : 'x64';
    const version = await this.version;
    const baseURL = this.getBaseURL(version);
    const archiveName = `electron-v${ version }-${ context.platform }-${ arch }.zip`;
    const url = `${ baseURL }${ archiveName }`;
    const archivePath = path.join(context.resourcesDir, 'host', archiveName);
    const outPath = path.join(process.cwd(), 'node_modules', 'electron', 'dist');
    const { default: upstreamChecksums } = await import('electron/checksums.json');
    const expectedChecksum = upstreamChecksums[archiveName as keyof typeof upstreamChecksums];
    const executable = {
      darwin: 'Electron.app/Contents/MacOS/Electron',
      linux:  'electron',
      win32:  'electron.exe',
    }[context.platform];

    if (!expectedChecksum) {
      // The upstream checksum is expected to always exist; we may need to
      // update how we look it up.
      throw new Error(`Upstream checksum is missing for ${ archiveName }`);
    }
    // If the version in the dependency manifest matches the version installed
    // via `package.json`, check that the recorded checksum matches the upstream
    // checksum; this ensures upstream hasn't been tampered with.
    if (context.dependencies[this.name].version === version) {
      const [recorded] = selectAssets(context, this.name, { platform: context.goPlatform, arch: GO_ARCH[arch] });
      const recordedChecksum = recorded && assetChecksum(recorded);

      if (recordedChecksum !== expectedChecksum) {
        throw new Error(`
          Upstream checksum for Electron archive ${ archiveName }
          is ${ expectedChecksum }, does not match recorded checksum ${ recordedChecksum }.
          `.replace(/\s+/g, ' '));
      }
    }

    await download(url, archivePath, { expectedChecksum });
    await simpleSpawn('unzip', ['-q', '-o', archivePath, '-d', outPath]);
    await fs.promises.access(path.join(outPath, executable), fs.constants.X_OK);
    // @electron/get writes this marker file to indicate that the download is complete.
    await fs.promises.writeFile(path.join(path.dirname(outPath), 'path.txt'), executable);
  }

  async getAssets(requestedVersion: string): Promise<DependencyAsset[]> {
    const version = await this.version;

    // We only use the version as installed via `package.json`.  The passed-in
    // version should only come from `getAvailableVersions`, so it should always
    // match, but we check just in case.
    if (requestedVersion !== version) {
      throw new Error(`
        Version of Electron installed via package.json (${ version })
        does not match requested version (${ requestedVersion }).
        `.replace(/\s+/g, ' '));
    }
    const baseURL = this.getBaseURL(version);
    const checksums: Record<string, string> = (await import('electron/checksums.json')).default;
    const platforms = cartesian(['darwin', 'linux', 'win32'] as const, ['x64', 'arm64'] as const);

    return Promise.all(platforms.map(async([platform, arch]) => {
      const archiveName = `electron-v${ version }-${ platform }-${ arch }.zip`;
      const url = `${ baseURL }${ archiveName }`;
      const checksum = await downloadAndHash(url, {
        verify: { algorithm: 'sha256', expected: checksums[archiveName] },
      });

      return {
        platform: GO_PLATFORM[platform], arch: GO_ARCH[arch], url, checksum,
      };
    }));
  };

  async getAvailableVersions(): Promise<string[]> {
    // We do Electron updates via dependabot.
    return [await this.version];
  }
}
