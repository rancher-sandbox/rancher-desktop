
import { VMExecutor } from '@pkg/backend/backend';
import { ContainerProcessor } from '@pkg/backend/containers/containerProcessor';
import MobyContainerProcessor from '@pkg/backend/containers/mobyContainerProcessor';
import NerdctlContainerProcessor from '@pkg/backend/containers/nerdctlContainerProcessor';
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
      cachedImageProcessors[engineName] = new MobyContainerProcessor(executor);
      break;
    case ContainerEngine.CONTAINERD:
      cachedImageProcessors[engineName] = new NerdctlContainerProcessor(executor);
      break;
    default:
      throw new Error(`No image processor called ${ engineName }`);
    }
  }

  return <ContainerProcessor>cachedImageProcessors[engineName];
}
