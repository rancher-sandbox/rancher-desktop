import { spawn } from 'child_process';
// import { Console } from 'console';
import path from 'path';

import * as K8s from '@/k8s-engine/k8s';
// import Logging from '@/utils/logging';
import resources from '@/resources';
import * as imageProcessor from '@/k8s-engine/images/imageProcessor';

const KUBE_CONTEXT = 'rancher-desktop';

// const console = new Console(Logging.images.stream);

class NerdctlImageProcessor extends imageProcessor.ImageProcessor {
  protected async runImagesCommand(args: string[], sendNotifications = true): Promise<imageProcessor.childResultType> {
    // Insert options needed for all calls to kim.
    const finalArgs = ['--context', KUBE_CONTEXT].concat(args);

    return await this.processChildOutput(spawn(resources.executable('nerdctl'), finalArgs), args[0], sendNotifications);
  }

  /**
   * Determine if the imageProcessor service needs to be reinstalled (always true for nerdctl?)
   */
  isInstallValid(mgr: K8s.KubernetesBackend, endpoint?: string): Promise<boolean> {
    return new Promise(resolve => resolve(true));
  }

  /**
   * Install the nerdctl backend should be a no-op
   */
  install(backend: K8s.KubernetesBackend, force = false, address?: string) {
  }

  async buildImage(dirPart: string, filePart: string, taggedImageName: string): Promise<imageProcessor.childResultType> {
    const args = ['build'];

    args.push('--file');
    args.push(path.join(dirPart, filePart));
    args.push('--tag');
    args.push(taggedImageName);
    args.push(dirPart);

    return await this.runImagesCommand(args);
  }

  async deleteImage(imageID: string): Promise<imageProcessor.childResultType> {
    return await this.runImagesCommand(['rmi', imageID]);
  }

  async pullImage(taggedImageName: string): Promise<imageProcessor.childResultType> {
    return await this.runImagesCommand(['pull', taggedImageName, '--debug']);
  }

  async pushImage(taggedImageName: string): Promise<imageProcessor.childResultType> {
    return await this.runImagesCommand(['push', taggedImageName, '--debug']);
  }

  async getImages(): Promise<imageProcessor.childResultType> {
    return await this.runImagesCommand(['images', '--all'], false);
  }

  async scanImage(taggedImageName: string): Promise<imageProcessor.childResultType> {
    return await this.runTrivyCommand(['image', '--no-progress', '--format', 'template',
      '--template', '@/var/lib/trivy.tpl', taggedImageName]);
  }

  parse(data: string): imageProcessor.imageType[] {
    const results = data.trimEnd().split(/\r?\n/).slice(1).map((line) => {
      const [imageName, tag, imageID, size] = line.split(/\s+/);

      return {
        imageName, tag, imageID, size
      };
    });

    return results;
  }
}

export default NerdctlImageProcessor;
