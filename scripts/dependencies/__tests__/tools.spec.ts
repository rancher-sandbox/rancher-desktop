/**
 * @jest-environment node
 */

import { DockerProvidedCredHelpers } from '../tools';

import { DependencyManifest, DownloadContext, parseSha256Checksum } from '@/scripts/lib/dependencies';

const sha = (hex: string) => parseSha256Checksum(`sha256:${ hex.padEnd(64, '0') }`);

/** A context for a linux/amd64 install, where two credential helpers are expected. */
function contextFor(manifest: DependencyManifest): DownloadContext {
  return {
    dependencies: manifest,
    manifestPath: 'dependencies.yaml',
    platform:     'linux',
    goPlatform:   'linux',
    isM1:         false,
    binDir:       '/nonexistent/bin',
  } as DownloadContext;
}

describe('DockerProvidedCredHelpers.download', () => {
  it('throws when the manifest records no matching assets', async() => {
    const context = contextFor({
      dockerProvidedCredentialHelpers: { version: '0.9.7', assets: [] },
    });

    await expect(new DockerProvidedCredHelpers().download(context)).rejects.toThrow(/expected 2 .*found 0/i);
  });

  it('throws when the manifest records only some of the expected helpers', async() => {
    const context = contextFor({
      dockerProvidedCredentialHelpers: {
        version: '0.9.7',
        assets:  [{
          platform: 'linux',
          arch:     'amd64',
          url:      'https://example.test/docker-credential-pass-v0.9.7.linux-amd64',
          checksum: sha('c3'),
        }],
      },
    });

    await expect(new DockerProvidedCredHelpers().download(context)).rejects.toThrow(/expected 2 .*found 1/i);
  });
});
