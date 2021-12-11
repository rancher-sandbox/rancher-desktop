import { spawn } from 'child_process';
import path from 'path';

import Logging from '@/utils/logging';
import resources from '@/resources';
import * as imageProcessor from '@/k8s-engine/images/imageProcessor';
import * as childProcess from '@/utils/childProcess';
import * as K8s from '@/k8s-engine/k8s';
import mainEvents from '@/main/mainEvents';

const console = Logging.images;

export default class NerdctlImageProcessor extends imageProcessor.ImageProcessor {
  constructor(k8sManager: K8s.KubernetesBackend) {
    super(k8sManager);

    mainEvents.on('k8s-check-state', async(mgr: K8s.KubernetesBackend) => {
      if (!this.active) {
        return;
      }
      this.isK8sReady = mgr.state === K8s.State.STARTED;
      try {
        this.updateWatchStatus();
        if (this.isK8sReady) {
          let endpoint: string | undefined;

          // XXX temporary hack: use a fixed address for kim endpoint
          if (mgr.backend === 'lima') {
            endpoint = '127.0.0.1';
          }

          const needsForce = !(await this.isInstallValid(mgr, endpoint));

          await this.installKimBuilder(mgr, needsForce, endpoint);
        }
      } catch (e) {
        if (e instanceof K8s.KimBuilderInstallError) {
          if (mgr.state !== K8s.State.STARTED) {
            console.debug(`Ignoring KimBuilderInstallError ${ e } during state ${ mgr.state }`);
          } else {
            mainEvents.emit('handle-failure', e.name, e.message, e.fatal);
          }
        } else {
          console.error('Error trying to install kim builder: ', e);
        }
      }
    });
  }

  protected get processorName() {
    return 'nerdctl';
  }

  protected async runImagesCommand(args: string[], sendNotifications = true): Promise<imageProcessor.childResultType> {
    const subcommandName = args[0];
    const namespacedArgs = ['--namespace', this.currentNamespace].concat(args);

    return await this.processChildOutput(spawn(resources.executable('nerdctl'), namespacedArgs), subcommandName, sendNotifications);
  }

  async buildImage(dirPart: string, filePart: string, taggedImageName: string): Promise<imageProcessor.childResultType> {
    const args = ['build',
      '--file', path.join(dirPart, filePart),
      '--tag', taggedImageName,
      dirPart];

    return await this.runImagesCommand(args);
  }

  async deleteImage(imageID: string): Promise<imageProcessor.childResultType> {
    return await this.runImagesCommand(['rmi', imageID]);
  }

  async pullImage(taggedImageName: string): Promise<imageProcessor.childResultType> {
    return await this.runImagesCommand(['pull', taggedImageName, '--debug']);
  }

  async pushImage(taggedImageName: string): Promise<imageProcessor.childResultType> {
    return await this.runImagesCommand(['push', taggedImageName]);
  }

  async getImages(): Promise<imageProcessor.childResultType> {
    return await this.runImagesCommand(
      ['images', '--format', '{{json .}}'],
      false);
  }

  async scanImage(taggedImageName: string): Promise<imageProcessor.childResultType> {
    return await this.runTrivyCommand(
      [
        '--quiet',
        'image',
        '--format',
        'json',
        taggedImageName
      ]);
  }

  async getNamespaces(): Promise<Array<string>> {
    const { stdout, stderr } = await childProcess.spawnFile(resources.executable('nerdctl'),
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
   * {"CreatedAt":"2021-10-05 22:04:20 +0000 UTC","CreatedSince":"20 hours ago","ID":"55fe4b211a51","Repository":"rancher/kim","Tag":"v0.1.0-beta.7","Size":"46.2 MiB"}
   * ...
   */

  parse(data: string): imageProcessor.imageType[] {
    const images: Array<imageProcessor.imageType> = [];
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
        size:      record.Size
      });
    }

    return images.sort(imageComparator);
  }
}

function imageComparator(a: imageProcessor.imageType, b: imageProcessor.imageType): number {
  return a.imageName.localeCompare(b.imageName) ||
    a.tag.localeCompare(b.tag) ||
    a.imageID.localeCompare(b.imageID);
}
