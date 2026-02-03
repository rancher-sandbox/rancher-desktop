import path from 'path';

import { VMBackend } from '@pkg/backend/backend';
import * as imageProcessor from '@pkg/backend/images/imageProcessor';
import * as K8s from '@pkg/backend/k8s';
import mainEvents from '@pkg/main/mainEvents';
import * as childProcess from '@pkg/utils/childProcess';
import Logging from '@pkg/utils/logging';
import { executable } from '@pkg/utils/resources';

const console = Logging.images;

export default class NerdctlImageProcessor extends imageProcessor.ImageProcessor {
  constructor(backend: VMBackend) {
    super(backend);

    mainEvents.on('k8s-check-state', (mgr: VMBackend) => {
      if (!this.active) {
        return;
      }
      this.isK8sReady = mgr.state === K8s.State.STARTED || mgr.state === K8s.State.DISABLED;
      this.updateWatchStatus();
    });
  }

  protected get processorName() {
    return 'nerdctl';
  }

  protected async runImagesCommand(args: string[], sendNotifications = true): Promise<imageProcessor.childResultType> {
    const subcommandName = args[0];

    return await this.processChildOutput(
      this.backend.containerEngineClient.runClient(args, 'stream', { namespace: this.currentNamespace }),
      {
        subcommandName,
        notifications: {
          stdout: sendNotifications, stderr: sendNotifications, ok: sendNotifications,
        },
      });
  }

  async buildImage(dirPart: string, filePart: string, taggedImageName: string): Promise<imageProcessor.childResultType> {
    const args = ['build',
      '--buildkit-host', 'unix:///run/buildkit/buildkitd.sock',
      '--file', path.join(dirPart, filePart),
      '--tag', taggedImageName,
      dirPart];

    return await this.runImagesCommand(args);
  }

  async deleteImage(imageID: string): Promise<imageProcessor.childResultType> {
    return await this.runImagesCommand(['rmi', imageID]);
  }

  async deleteImages(imageIDs: string[]): Promise<imageProcessor.childResultType> {
    return await this.runImagesCommand(['rmi', ...imageIDs]);
  }

  async pullImage(taggedImageName: string): Promise<imageProcessor.childResultType> {
    return await this.runImagesCommand(['pull', taggedImageName]);
  }

  async pushImage(taggedImageName: string): Promise<imageProcessor.childResultType> {
    return await this.runImagesCommand(['push', taggedImageName]);
  }

  async getImages(): Promise<imageProcessor.childResultType> {
    return await this.runImagesCommand(
      ['images', '--digests', '--format', '{{json .}}'],
      false);
  }

  scanImage(taggedImageName: string, namespace: string): Promise<imageProcessor.childResultType> {
    return this.runTrivyScan(
      taggedImageName,
      {
        CONTAINERD_ADDRESS:   '/run/k3s/containerd/containerd.sock',
        CONTAINERD_NAMESPACE: namespace,
      },
    );
  }

  async getNamespaces(): Promise<string[]> {
    const { stdout, stderr } = await childProcess.spawnFile(executable('nerdctl'),
      ['namespace', 'list', '--quiet'],
      { stdio: ['inherit', 'pipe', 'pipe'] });

    if (stderr) {
      console.log(`Error getting namespaces: ${ stderr }`, stderr);
    }

    return stdout.trim().split(/\r?\n/).map(line => line.trim()).sort();
  }

  /**
   * Sample output (line-oriented JSON output, as opposed to one JSON document):
   *
   * {"CreatedAt":"2021-10-05 22:04:12 +0000 UTC","CreatedSince":"20 hours ago","ID":"171689e43026","Repository":"","Tag":"","Size":"119.2 MiB"}
   * {"CreatedAt":"2021-10-05 22:04:20 +0000 UTC","CreatedSince":"20 hours ago","ID":"55fe4b211a51","Repository":"rancher/k3d","Tag":"v0.1.0-beta.7","Size":"46.2 MiB"}
   * ...
   */

  parse(data: string): imageProcessor.ImageType[] {
    const images: imageProcessor.ImageType[] = [];
    const records = data.split(/\r?\n/)
      .filter(line => line.trim().length > 0)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (err) {
          console.log(`Error json-parsing line [${ line }]:`, err);

          return null;
        }
      })
      .filter(record => record);

    for (const record of records) {
      if (['', 'sha256'].includes(record.Repository)) {
        continue;
      }
      images.push({
        imageName: record.Repository,
        tag:       record.Tag,
        imageID:   record.ID,
        size:      record.Size,
        digest:    record.Digest,
      });
    }

    return images.sort(imageComparator);
  }
}

function imageComparator(a: imageProcessor.ImageType, b: imageProcessor.ImageType): number {
  return a.imageName.localeCompare(b.imageName) ||
    a.tag.localeCompare(b.tag) ||
    a.imageID.localeCompare(b.imageID);
}
