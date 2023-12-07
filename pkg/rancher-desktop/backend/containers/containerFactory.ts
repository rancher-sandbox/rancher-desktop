
import { VMExecutor } from '@pkg/backend/backend';
import { ContainerProcessor } from '@pkg/backend/containers/containerProcessor';
import MobyImageProcessor from '@pkg/backend/containers/mobyContainerProcessor';
import NerdctlImageProcessor from '@pkg/backend/containers/nerdctlContainerProcessor';
import { ContainerEngine } from '@pkg/config/settings';

const cachedImageProcessors: Partial<
  Record<ContainerEngine, ContainerProcessor>
> = {};

export function getContainerProcessor(
  engineName: ContainerEngine,
  executor: VMExecutor,
): ContainerProcessor {
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

  return <ContainerProcessor>cachedImageProcessors[engineName];
}
