import { VMBackend } from '@pkg/backend/backend';
import { ImageProcessor } from '@pkg/backend/images/imageProcessor';
import MobyImageProcessor from '@pkg/backend/images/mobyImageProcessor';
import NerdctlImageProcessor from '@pkg/backend/images/nerdctlImageProcessor';
import { ContainerEngine } from '@pkg/config/settings';

const cachedImageProcessors: Partial<Record<ContainerEngine, ImageProcessor>> = { };

/**
 * Return the appropriate ImageProcessor singleton for the specified ContainerEngine.
 */
export function getImageProcessor(engineName: ContainerEngine, executor: VMBackend): ImageProcessor {
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

  return cachedImageProcessors[engineName]!;
}
