import { ImageProcessor } from '@/k8s-engine/images/imageProcessor';
import NerdctlImageProcessor from '@/k8s-engine/images/nerdctlImageProcessor';
import MobyImageProcessor from '@/k8s-engine/images/mobyImageProcessor';
import { ContainerEngine } from '@/config/settings';
import * as K8s from '@/k8s-engine/k8s';

const cachedImageProcessors: Partial<Record<ContainerEngine, ImageProcessor>> = { };

/**
 * Return the appropriate ImageProcessor singleton for the specified ContainerEngine.
 */
export function getImageProcessor(engineName: ContainerEngine, k8sManager: K8s.KubernetesBackend): ImageProcessor {
  if (!(engineName in cachedImageProcessors)) {
    switch (engineName) {
    case ContainerEngine.MOBY:
      cachedImageProcessors[engineName] = new MobyImageProcessor(k8sManager);
      break;
    case ContainerEngine.CONTAINERD:
      cachedImageProcessors[engineName] = new NerdctlImageProcessor(k8sManager);
      break;
    default:
      throw new Error(`No image processor called ${ engineName }`);
    }
  }

  return <ImageProcessor>cachedImageProcessors[engineName];
}
