import { ImageProcessor } from '@/k8s-engine/images/imageProcessor';
import NerdctlImageProcessor from '@/k8s-engine/images/nerdctlImageProcessor';
import MobyImageProcessor from '@/k8s-engine/images/mobyImageProcessor';
import { ContainerEngine } from '@/config/settings';
import * as K8s from '@/k8s-engine/k8s';

const cachedImageProcessors: Partial<Record<ContainerEngine, ImageProcessor|null>> = { };

/**
 * Think of the ImageProcessors as a set of named singletons, where the name of each IP
 * is given by its associated ContainerEngine ('moby' and 'containerd' at this point).
 * So it makes sense to store them in a cache, and create each when needed.
 */
export function createImageProcessor(engineName: ContainerEngine, k8sManager: K8s.KubernetesBackend): ImageProcessor {
  if (!(engineName in cachedImageProcessors)) {
    switch (engineName) {
    case ContainerEngine.MOBY:
      cachedImageProcessors[engineName] = new MobyImageProcessor(k8sManager, engineName);
      break;
    case ContainerEngine.CONTAINERD:
      cachedImageProcessors[engineName] = new NerdctlImageProcessor(k8sManager, engineName);
      break;
    default:
      throw new Error(`No image processor called ${ engineName }`);
    }
  }

  return cachedImageProcessors[engineName] as ImageProcessor;
}
