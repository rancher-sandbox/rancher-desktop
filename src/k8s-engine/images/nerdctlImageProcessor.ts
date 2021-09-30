import { spawn } from 'child_process';
import { Console } from 'console';
import path from 'path';

import * as K8s from '@/k8s-engine/k8s';
import Logging from '@/utils/logging';
import resources from '@/resources';
import * as imageProcessor from '@/k8s-engine/images/imageProcessor';
import * as childProcess from '@/utils/childProcess';

const console = new Console(Logging.images.stream);

class NerdctlImageProcessor extends imageProcessor.ImageProcessor {
  constructor(k8sManager: K8s.KubernetesBackend) {
    super(k8sManager);
    this.processorName = 'nerdctl';
  }

  protected async runImagesCommand(args: string[], sendNotifications = true): Promise<imageProcessor.childResultType> {
    return await this.processChildOutput(spawn(resources.executable('nerdctl'), args), args[0], sendNotifications);
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
    const args = ['--namespace', this.currentNamespace, 'build',
      '--file', path.join(dirPart, filePart),
      '--tag', taggedImageName,
      dirPart];

    return await this.runImagesCommand(args);
  }

  async deleteImage(imageID: string): Promise<imageProcessor.childResultType> {
    return await this.runImagesCommand(['--namespace', this.currentNamespace, 'rmi', imageID]);
  }

  async pullImage(taggedImageName: string): Promise<imageProcessor.childResultType> {
    return await this.runImagesCommand(['--namespace', this.currentNamespace, 'pull', taggedImageName, '--debug']);
  }

  async pushImage(taggedImageName: string): Promise<imageProcessor.childResultType> {
    return await this.runImagesCommand(['--namespace', this.currentNamespace, 'push', taggedImageName]);
  }

  async getImages(): Promise<imageProcessor.childResultType> {
    return await this.runImagesCommand(['--namespace', this.currentNamespace, 'images'], false);
  }

  async scanImage(taggedImageName: string): Promise<imageProcessor.childResultType> {
    return await this.runTrivyCommand(['image', '--no-progress', '--format', 'template',
      '--template', '@/var/lib/trivy.tpl', taggedImageName]);
  }

  async getNamespaces(): Promise<Array<string>> {
    const { stdout, stderr } = await childProcess.spawnFile(resources.executable('nerdctl'),
      ['namespace', 'ls'],
      { stdio: ['inherit', 'pipe', 'pipe'] });

    if (stderr) {
      console.log(`Error getting namespaces: ${ stderr }`, stderr);
    }

    return (stdout || '').toString().trimEnd().split(/\r?\n/).slice(1)
      .map((line:string) => {
        return line.split(/\s+/, 1)[0];
      })
      .sort();
  }

  /**
   * Sample output:
   * REPOSITORY        TAG       IMAGE ID        CREATED          SIZE
   * camelpunch/pr     latest    f6b002c6f990    2 seconds ago    95.7 MiB
   * ruby              latest    5139d3c9f2fc    9 minutes ago    911.0 MiB
   * gibley/whoami     v01       31c94d15c40f    4 minutes ago    8.2 MiB
   *                             31c94d15c40f    4 minutes ago    8.2 MiB

   * @param data (like the above example)
   *
   * Because the input is so free-form, we assume it's tab-less ASCII, and parse the
   * headers to determine the width of each column. Then those widths are used
   * to parse each line. Duplicates are culled into the most informative line
   */
  parse(data: string): imageProcessor.imageType[] {
    const bestLines: Record<string, imageProcessor.imageType> = {};
    const lines = data.trimEnd().split(/\r?\n/);
    const headerLine = lines?.shift()?.replace('IMAGE ID', 'IMAGE_ID');
    const sizes: Array<number> = [];
    const fieldsWithWhitespace = headerLine?.split(/\b/) || [''];

    fieldsWithWhitespace.pop();
    for (let i = 0; i < fieldsWithWhitespace.length - 1; i += 2) {
      sizes.push(fieldsWithWhitespace[i].length + fieldsWithWhitespace[i + 1].length);
    }

    const columnMatcher = new RegExp(`${ sizes.map( size => `(.{${ size }})`).join('') }(.*)`);

    data.trimEnd().split(/\r?\n/).slice(1).map((line) => {
      const m = columnMatcher.exec(line);

      if (!m) {
        throw new Error(`Failed to match ${ columnMatcher } on [${ line }]`);
      }
      const [imageName, tag, imageID, _, size] = m.slice(1).map(s => s.trim());

      if (!imageName || imageName === 'sha256') {
        return;
      }
      // Replace the entry with the longer tag with the one with the shorter tag
      if (!bestLines[imageID] || bestLines[imageID].tag.indexOf(tag) === 0) {
        bestLines[imageID] = {
          imageName, tag, imageID, size
        };
      }
    });

    return Object.values(bestLines).sort(imageComparator);
  }
}

function imageComparator(a: imageProcessor.imageType, b: imageProcessor.imageType): number {
  const nameA = a.imageName.toLowerCase();
  const nameB = b.imageName.toLowerCase();

  return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
}

export default NerdctlImageProcessor;
