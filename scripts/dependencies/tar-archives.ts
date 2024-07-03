import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import stream from 'stream';

import tar from 'tar-stream';

import { AlpineLimaISOVersion, Dependency, DownloadContext } from 'scripts/lib/dependencies';

export class ExtensionProxyImage implements Dependency {
  name = 'rdx-proxy.tar';
  dependencies(context: DownloadContext) {
    return [`extension-proxy:linux`];
  }

  async download(context: DownloadContext): Promise<void> {
    // Build the extension proxy image.
    const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rd-build-rdx-pf-'));

    try {
      const executablePath = path.join(context.resourcesDir, 'linux', 'staging', 'extension-proxy');
      const layerPath = path.join(workDir, 'layer.tar');
      const imagePath = path.join(context.resourcesDir, 'rdx-proxy.tar');

      console.log('Building RDX proxying image...');

      // Build the layer tarball
      // tar streams don't implement piping to multiple writers, and stream.Duplex
      // can't deal with it either; so we need to fully write out the file, then
      // calculate the hash as a separate step.
      const layer = tar.pack();
      const layerOutput = layer.pipe(fs.createWriteStream(layerPath));
      const executableStats = await fs.promises.stat(executablePath);

      await stream.promises.finished(
        fs.createReadStream(executablePath)
          .pipe(layer.entry({
            name:  path.basename(executablePath),
            mode:  0o755,
            type:  'file',
            mtime: new Date(0),
            size:  executableStats.size,
          })));
      layer.finalize();
      await stream.promises.finished(layerOutput);

      // calculate the hash
      const layerReader = fs.createReadStream(layerPath);
      const layerHasher = layerReader.pipe(crypto.createHash('sha256'));

      await stream.promises.finished(layerReader);

      // Build the image tarball
      const layerHash = layerHasher.digest().toString('hex');
      const image = tar.pack();
      const imageWritten =
        stream.promises.finished(
          image
            .pipe(fs.createWriteStream(imagePath)));
      const addEntry = (name: string, input: Buffer | stream.Readable, size?: number) => {
        if (Buffer.isBuffer(input)) {
          size = input.length;
          input = stream.Readable.from(input);
        }

        return stream.promises.finished((input as stream.Readable).pipe(image.entry({
          name,
          size,
          type:  'file',
          mtime: new Date(0),
        })));
      };

      image.entry({ name: layerHash, type: 'directory' });
      await addEntry(`${ layerHash }/VERSION`, Buffer.from('1.0'));
      await addEntry(`${ layerHash }/layer.tar`, fs.createReadStream(layerPath), layerOutput.bytesWritten);
      await addEntry(`${ layerHash }/json`, Buffer.from(JSON.stringify({
        id:     layerHash,
        config: {
          ExposedPorts: { '80/tcp': {} },
          WorkingDir:   '/',
          Entrypoint:   [`/${ path.basename(executablePath) }`],
        },
      })));
      await addEntry(`${ layerHash }.json`, Buffer.from(JSON.stringify({
        architecture: context.isM1 ? 'arm64' : 'amd64',
        config:       {
          ExposedPorts: { '80/tcp': {} },
          Entrypoint:   [`/${ path.basename(executablePath) }`],
          WorkingDir:   '/',
        },
        history: [],
        os:      'linux',
        rootfs:  {
          type:     'layers',
          diff_ids: [`sha256:${ layerHash }`],
        },
      })));
      await addEntry('manifest.json', Buffer.from(JSON.stringify([
        {
          Config:   `${ layerHash }.json`,
          RepoTags: ['ghcr.io/rancher-sandbox/rancher-desktop/rdx-proxy:latest'],
          Layers:   [`${ layerHash }/layer.tar`],
        },
      ])));
      image.finalize();
      await imageWritten;
      console.log('Built RDX port proxy image');
    } finally {
      await fs.promises.rm(workDir, { recursive: true });
    }
  }

  getAvailableVersions(includePrerelease?: boolean | undefined): Promise<string[] | AlpineLimaISOVersion[]> {
    throw new Error('extension-proxy does not have versions.');
  }

  rcompareVersions(version1: string | AlpineLimaISOVersion, version2: string | AlpineLimaISOVersion): 0 | 1 | -1 {
    throw new Error('extension-proxy does not have versions.');
  }
}
