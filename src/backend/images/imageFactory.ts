import { ImageProcessor } from '@/backend/images/imageProcessor';
import MobyImageProcessor from '@/backend/images/mobyImageProcessor';
import NerdctlImageProcessor from '@/backend/images/nerdctlImageProcessor';
import * as K8s from '@/backend/k8s';
import { ContainerEngine } from '@/config/settings';

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
