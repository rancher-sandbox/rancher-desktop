import { DiagnosticsCategory, DiagnosticsChecker } from './types';

import { ContainerEngine } from '@pkg/config/settings';
import mainEvents from '@pkg/main/mainEvents';

const id = 'MOBY_IMAGE_STORE';
const documentation = 'https://docs.rancherdesktop.io/troubleshooting/migrating-images/';

let containerEngine: ContainerEngine = ContainerEngine.NONE;
let state = {
  hasClassicData:     false,
  hasSnapshotterData: false,
  useSnapshotter:     false,
};

mainEvents.on('settings-update', (settings) => {
  containerEngine = settings.containerEngine.name;
});

mainEvents.on('diagnostics-event', (payload) => {
  if (payload.id === 'moby-storage') {
    state = payload;
    mainEvents.invoke('diagnostics-trigger', id);
  }
});

/**
 * We use moby's containerd image store for new VMs, as well as when WASM is
 * enabled; however, the migration in Rancher Desktop 1.21 had a bug that caused
 * some users to end up using the containerd snapshotter when they still had
 * data in the old moby image store.  Detect when we have data in both and warn
 * the user.
 */
class CheckMobyImageStore implements DiagnosticsChecker {
  readonly id = id;

  category = DiagnosticsCategory.ContainerEngine;
  applicable(): Promise<boolean> {
    return Promise.resolve(containerEngine === ContainerEngine.MOBY);
  }

  async check() {
    if (!await this.applicable()) {
      return {
        passed:      true,
        description: 'Moby container engine is not in use',
        fixes:       [],
      };
    }

    if (state.hasClassicData && state.useSnapshotter) {
      if (state.hasSnapshotterData) {
        return {
          passed:        false,
          description:   `There are images in both the moby classic storage driver and the containerd image store.  Currently using the containerd snapshotter.`,
          fixes:         [],
          documentation,
        };
      }
      return {
        passed:        false,
        description:   `There are images in the moby classic storage driver, but the containerd snapshotter is being used.`,
        fixes:         [],
        documentation,
      };
    } else if (state.hasSnapshotterData && !state.useSnapshotter) {
      return {
        passed:        false,
        description:   `There are images in the containerd image store, but the moby classic storage driver is being used.`,
        fixes:         [],
        documentation,
      };
    }

    return {
      passed:      true,
      description: `There are no issues with the moby image store: classic:${ state.hasClassicData } snapshotter:${ state.hasSnapshotterData } using snapshotter:${ state.useSnapshotter }`,
      fixes:       [],
    };
  }
}

export default new CheckMobyImageStore();
