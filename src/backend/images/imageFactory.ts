import { VMExecutor } from '@/backend/backend';
import { ImageProcessor } from '@/backend/images/imageProcessor';
import MobyImageProcessor from '@/backend/images/mobyImageProcessor';
import NerdctlImageProcessor from '@/backend/images/nerdctlImageProcessor';
import { ContainerEngine } from '@/config/settings';

const cachedImageProcessors: Partial<Record<ContainerEngine, ImageProcessor>> = { };

/**
 * Return the appropriate ImageProcessor singleton for the specified ContainerEngine.
 */
export function getImageProcessor(engineName: ContainerEngine, executor: VMExecutor): ImageProcessor {
  if (!(engineName in cachedImageProcessors)) {
    switch (engineName) {
    case ContainerEngine.MOBY:
      cachedImageProcessors[engineName] = new MobyImageProcessor(executor);
      break;
    case ContainerEngine.CONTAINERD:
      cachedImageProcessors[engineName] = new NerdctlImageProcessor(executor);
      break;
    default:
      throw new Error(`No image processor called ${ engineName }`);
    }
  }

  return <ImageProcessor>cachedImageProcessors[engineName];
}
