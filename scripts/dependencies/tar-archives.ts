import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import stream from 'stream';

import tar from 'tar-stream';

import { Dependency, DownloadContext } from 'scripts/lib/dependencies';

export class ExtensionProxyImage implements Dependency {
  readonly name = 'rdx-proxy.tar';
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
      const imageStream = fs.createWriteStream(imagePath);
      const imageWritten = stream.promises.finished(imageStream);

      image.pipe(imageStream);
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
}

export class WSLDistroImage implements Dependency {
  readonly name = 'WSLDistroImage';
  dependencies(context: DownloadContext): string[] {
    return [
      'WSLDistro:win32',
      'guestagent:linux',
      'vm-switch:linux',
      'network-setup:linux',
      'wsl-proxy:linux',
      'trivy:linux',
    ];
  }

  async download(context: DownloadContext): Promise<void> {
    const tarName = `distro-${ context.versions.WSLDistro }.tar`;
    const pristinePath = path.join(context.resourcesDir, context.platform, 'staging', tarName);
    const pristineFile = fs.createReadStream(pristinePath);
    const extractor = tar.extract();
    const destPath = path.join(context.resourcesDir, context.platform, tarName);
    const destFile = fs.createWriteStream(destPath);
    const packer = tar.pack();

    console.log('Building WSLDistro image...');

    // Copy the pristine tar file to the destination.
    packer.pipe(destFile);
    extractor.on('entry', (header, stream, callback) => {
      stream.pipe(packer.entry(header, callback));
    });
    await stream.promises.finished(pristineFile.pipe(extractor));

    async function addFile(fromPath: string, name: string, options: Omit<tar.Headers, 'name' | 'size'> = {}) {
      const { size } = await fs.promises.stat(fromPath);
      const inputFile = fs.createReadStream(fromPath);

      console.log(`WSL Distro: Adding ${ fromPath } to ${ name }...`);
      await stream.promises.finished(inputFile.pipe(packer.entry({
        name,
        size,
        mode:  0o755,
        type:  'file',
        mtime: new Date(0),
        ...options,
      })));
    }

    // Add extra files.
    const extraFiles = {
      'linux/staging/guestagent':    'usr/local/bin/rancher-desktop-guestagent',
      'linux/staging/vm-switch':     'usr/local/bin/vm-switch',
      'linux/staging/network-setup': 'usr/local/bin/network-setup',
      'linux/staging/wsl-proxy':     'usr/local/bin/wsl-proxy',
      'linux/staging/trivy':         'usr/local/bin/trivy',
    };

    await Promise.all(Object.entries(extraFiles).map(([src, dest]) => {
      return addFile(path.join(context.resourcesDir, ...src.split('/')), dest);
    }));

    // Finish the archive.
    packer.finalize();
    await stream.promises.finished(packer as any);
    console.log('Built WSLDistro image.');
  }
}
