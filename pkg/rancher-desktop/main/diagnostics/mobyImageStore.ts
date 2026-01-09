import { DiagnosticsCategory, DiagnosticsChecker } from './types';

import { State, VMBackend } from '@pkg/backend/backend';
import { ContainerEngine } from '@pkg/config/settings';
import mainEvents from '@pkg/main/mainEvents';
import Logging from '@pkg/utils/logging';

const console = Logging.diagnostics;
const documentation = 'https://docs.rancherdesktop.io/troubleshooting/migrating-images/';

// TODO: Use the actual setting once that's implemented.
type StorageDriver = 'classic' | 'snapshotter' | undefined;

let k8smanager: VMBackend | undefined;
let containerEngine: ContainerEngine = ContainerEngine.NONE;
let preference: StorageDriver;
let triggerOnStateChange = false;

mainEvents.on('k8s-check-state', (manager) => {
  k8smanager = manager;
  if (triggerOnStateChange) {
    triggerOnStateChange = false;
    mainEvents.invoke('diagnostics-trigger', 'MOBY_IMAGE_STORE');
  }
});

mainEvents.on('settings-update', (settings) => {
  containerEngine = settings.containerEngine.name;
  // TODO: Use the actual setting once that's implemented.
  preference = 'snapshotter';
});

function pluralizeImages(count: number): string {
  return count === 1 ? `${ count } image` : `${ count } images`;
}

/**
 * We use moby's containerd image store for new VMs, as well as when WASM is
 * enabled; however, the migration in Rancher Desktop 1.21 had a bug that caused
 * some users to end up using the containerd snapshotter when they still had
 * data in the old moby image store.  Detect when we have data in both and warn
 * the user.
 */
class CheckMobyImageStore implements DiagnosticsChecker {
  readonly id = 'MOBY_IMAGE_STORE';

  category = DiagnosticsCategory.ContainerEngine;
  applicable(): Promise<boolean> {
    return Promise.resolve(containerEngine === ContainerEngine.MOBY);
  }

  async check() {
    if (!k8smanager || ![State.STARTED, State.DISABLED].includes(k8smanager.state)) {
      // Reschedule the check.
      console.debug(`${ this.id }: backend not ready (state: ${ k8smanager?.state ?? 'unknown' }); rescheduling check.`);
      triggerOnStateChange = true;
      return {
        passed:      true,
        description: 'Backend not ready; will be checked again shortly.',
        fixes:       [],
      };
    }

    let mobyTags = new Set<string>();
    try {
      const mobyData = await k8smanager.executor.readFile('/var/lib/docker/image/overlay2/repositories.json');

      mobyTags = new Set(Object.values<Record<string, unknown>>(JSON.parse(mobyData).Repositories).flatMap(t => Object.keys(t)));
    } catch (ex) {
      // Assume that we do not have any data in the moby classic storage driver.
      console.debug(`${ this.id }: failed to read moby classic image store: ${ ex }`);
    }
    console.debug(`${ this.id }: moby classic images: ${ Array.from(mobyTags).join(', ') }`);

    let containerdTags = new Set<string>();
    try {
      const containerdData = await k8smanager.executor.execCommand(
        { capture: true, root: true },
        '/usr/bin/ctr', '--address=/var/run/docker/containerd/containerd.sock',
        '--namespace=moby', 'images', 'list', '--quiet');
      containerdTags = new Set(containerdData.split('\n').map(line => line.trim()).filter(line => line));
    } catch (ex) {
      // Assume that we do not have any data in the containerd image store.
      console.debug(`${ this.id }: failed to read containerd image store: ${ ex }`);
    }
    console.debug(`${ this.id }: containerd images: ${ Array.from(containerdTags).join(', ') }`);

    if (mobyTags.size > 0 && containerdTags.size > 0) {
      return {
        passed:        false,
        description:   `There are ${ pluralizeImages(mobyTags.size) } in the moby classic storage driver and ${ pluralizeImages(containerdTags.size) } in the containerd image store.`,
        fixes:         [],
        documentation,
      };
    }

    if (mobyTags.size > 0 && preference !== 'classic') {
      // There is data in the classic storage driver, but we're not using it.
      return {
        passed:        false,
        description:   `There are ${ pluralizeImages(mobyTags.size) } in the moby classic storage driver, but the containerd snapshotter is in use.`,
        fixes:         [],
        documentation,
      };
    }

    if (containerdTags.size > 0 && preference === 'classic') {
      // There is data in the containerd image store, but we're not using it.
      return {
        passed:        false,
        description:   `There are ${ pluralizeImages(containerdTags.size) } in the containerd image store, but the moby classic storage driver is in use.`,
        fixes:         [],
        documentation,
      };
    }

    return {
      passed:      true,
      description: 'No images found in either moby classic storage driver or containerd image store.',
      fixes:       [],
    };
  }
}

export default new CheckMobyImageStore();
