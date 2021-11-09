import { ImageProcessor } from '@/k8s-engine/images/imageProcessor';
import NerdctlImageProcessor from '@/k8s-engine/images/nerdctlImageProcessor';
import MobyImageProcessor from '@/k8s-engine/images/mobyImageProcessor';
import { ContainerEngine } from '@/config/settings';
import * as K8s from '@/k8s-engine/k8s';

const cachedImageProcessors: Record<string, ImageProcessor> = {} as Record<string, ImageProcessor>;

/**
 * @param engineName: one of the values from the settings.ContainerEngine enum
 * @param k8sManager
 */
export function createImageProcessor(engineName: string, k8sManager: K8s.KubernetesBackend): ImageProcessor {
  if (!(engineName in cachedImageProcessors)) {
    const imageProcessor = createImageProcessorFromEngineName(engineName, k8sManager);

    if (!imageProcessor) {
      throw new Error(`No image processor called ${ engineName }`);
    }
    cachedImageProcessors[engineName] = imageProcessor;
  }

  return cachedImageProcessors[engineName];
}

export function createImageProcessorFromEngineName(engineName: string, k8sManager: K8s.KubernetesBackend): ImageProcessor|null {
  switch (engineName as ContainerEngine) {
  case ContainerEngine.MOBY:
    return new MobyImageProcessor(k8sManager, engineName);
  case ContainerEngine.CONTAINERD:
    return new NerdctlImageProcessor(k8sManager, engineName);
  }

  return null;
}
