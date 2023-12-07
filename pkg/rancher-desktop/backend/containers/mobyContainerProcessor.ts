
import { VMBackend, VMExecutor } from '@pkg/backend/backend';
import * as containerProcessor from '@pkg/backend/containers/containerProcessor';
import * as K8s from '@pkg/backend/k8s';
import mainEvents from '@pkg/main/mainEvents';
import * as window from '@pkg/window';

export default class MobyContainerProcessor extends containerProcessor.ContainerProcessor {
  constructor(executor: VMExecutor) {
    super(executor);

    mainEvents.on('k8s-check-state', (mgr: VMBackend) => {
      if (!this.active) {
        return;
      }
      this.isK8sReady =
        mgr.state === K8s.State.STARTED || mgr.state === K8s.State.DISABLED;
      // this.updateWatchStatus();
    });
  }

  protected get processorName() {
    return 'moby';
  }

  runContainerCommand(args: string[], sendNotifications = true): Promise<containerProcessor.childResultType> {
    throw new Error("docker doesn't support namespaces");
  }

  relayNamespaces(): Promise<void> {
    window.send('containers-namespaces', []);

    return Promise.resolve();
  }

  getNamespaces(): Promise<Array<string>> {
    throw new Error("docker doesn't support namespaces");
  }

  getNamespacedContainers(): Promise<Array<string>> {
    throw new Error("docker doesn't support namespaces");
  }
}
