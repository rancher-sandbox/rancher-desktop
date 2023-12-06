import { EventEmitter } from 'events';

import { VMExecutor } from '@pkg/backend/backend';
import mainEvents from '@pkg/main/mainEvents';
import * as window from '@pkg/window';

export interface childResultType {
  stdout: string;
  stderr: string;
}

export abstract class ContainerProcessor extends EventEmitter {
  protected active = false;
  protected isK8sReady = false;
  protected currentNamespace = 'default';

  protected constructor(protected executor: VMExecutor) {
    super();
    this.executor = executor;

    mainEvents.on('settings-update', (cfg) => {
      if (!this.active) {
        return;
      }

      if (this.namespace !== cfg.containers.namespace) {
        this.namespace = cfg.containers.namespace;
        // this.refreshImages().catch((err: Error) => {
        //   console.log(`Error refreshing images:`, err);
        // });
      }
    });
  }

  /** Relay the containers in the current namespace to the frontend */
  async relayNamespacesContainers() {
    const namespacedContainers = await this.getNamespacedContainers();

    window.send('containers-namespaces-containers', namespacedContainers);
  }

  /**
   * Relay the list of namespaces to the frontend
   */
  async relayNamespaces() {
    const namespaces = await this.getNamespaces();

    const comparator = Intl.Collator(undefined, { sensitivity: 'base' }).compare;

    if (!namespaces.includes('default')) {
      namespaces.push('default');
    }
    window.send('containers-namespaces', namespaces.sort(comparator));
  }

  activate() {
    this.active = true;
  }

  get namespace() {
    return this.currentNamespace;
  }

  set namespace(value: string) {
    this.currentNamespace = value;
  }

  abstract getNamespaces(): Promise<Array<string>>;
  abstract getNamespacedContainers(): Promise<Array<string>>;
}
