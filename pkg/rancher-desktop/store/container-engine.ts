import merge from 'lodash/merge';
import { MutationTree, Dispatch, GetterTree } from 'vuex';

import { ActionTree, MutationsType } from './ts-helpers';

import { ContainerEngine } from '@pkg/config/settings';
import type { RDXClient } from '@pkg/preload/extensions';

type ValidContainerEngine = Exclude<ContainerEngine, ContainerEngine.NONE>;
type SubscriberType = 'containers' | 'volumes';

/**
 * Shared extension API container list result parts
 */
interface ApiContainer {
  Id:      string;
  Command: string;
  Created: number;
  Image:   string;
  ImageID: string;
  Status:  string;
  Mounts:       {
    Type:        string;
    Name?:       string;
    Source:      string;
    Destination: string;
    Mode:        string;
    RW:          boolean;
    Propagation: string;
  }[];
  SizeRootFs: number;
  SizeRw:     number;
  Ports:      Record</* port/proto */string, { HostIp: string, HostPort: string }[] | null>;
  Labels:     Record<string, string>;
  State:      string;
  Names:      string[];
}

/**
 * The container API response from moby.
 */
interface MobyContainer extends ApiContainer {
  ImageID: string; // sha256:...
  Mounts:  (ApiContainer['Mounts'][number] & { Driver: string })[];
  State:   'created' | 'running' | 'paused' | 'restarting' | 'removing' | 'exited' | 'dead';
}

/**
 * The container API response from nerdctl.
 * @see github.com/containerd/nerdctl/v2/pkg/cmd/container#ListItem
 */
interface NerdctlContainer extends ApiContainer {
  ImageID: string; // same as Image, registry/image:tags
  Status:  'Created' | 'Paused' | 'Pausing' | 'Unknown' | 'Up' | string;
  State:   'created' | 'running' | 'paused' | 'pausing' | 'unknown' | 'exited' | 'restarting' | '';
}

/**
 * Each container is an object to be described in the UI.
 */
export interface Container {
  id:            string;
  containerName: string;
  imageName:     string;
  state:         MobyContainer['State'] | NerdctlContainer['State'];
  uptime:        string;
  projectGroup:  string;
  labels:        Record<string, string>;
  ports:         Record<string, { HostIp: string, HostPort: string }[] | null>;
}

export interface Volume {
  Name:       string;
  Driver:     string;
  Mountpoint: string;
  Labels:     Record<string, string>;
  Scope:      'local' | 'global';
  Options:    Record<string, any>;
  UsageData: {
    Size?:     number;
    RefCount?: number;
  };
  CreatedAt: string;
  Created:   number;
}

class Subscriber {
  subscription?: { unsubscribe(): void };
  destroy() {
    this.subscription?.unsubscribe();
  }
}

type SubscriberConstructor =
  new (client: RDXClient, dispatch: Dispatch, namespace?: string) => Subscriber;

class MobyContainerSubscriber extends Subscriber {
  constructor(client: RDXClient, dispatch: Dispatch) {
    super();
    this.subscription = client.docker.rdSubscribeToEvents(
      () => dispatch('fetchContainers'),
      {
        filters: {
          type:  ['container'],
          event: ['create', 'start', 'stop', 'die', 'kill', 'pause', 'unpause', 'rename', 'update', 'destroy', 'remove'],
        },
      });
  }
}

class MobyVolumeSubscriber extends Subscriber {
  constructor(client: RDXClient, dispatch: Dispatch) {
    super();
    this.subscription = client.docker.rdSubscribeToEvents(
      () => dispatch('fetchVolumes'),
      {
        filters: {
          type:  ['volume'],
          event: ['create', 'destroy', 'mount', 'unmount'],
        },
      });
  }
}

class NerdctlContainerSubscriber extends Subscriber {
  constructor(client: RDXClient, dispatch: Dispatch, namespace?: string) {
    super();
    // Nerdctl does not support the filtering we need
    this.subscription = client.docker.rdSubscribeToEvents(
      (event) => {
        const topic: string = (event as any).Topic;
        if (topic.startsWith('/containers/')) {
          dispatch('fetchContainers');
        } else if (topic.startsWith('/namespaces/')) {
          dispatch('fetchNamespaces');
        }
      },
      { namespace },
    );
  }
}

class NerdctlVolumeSubscriber extends Subscriber {
  interval: ReturnType<typeof setInterval>;
  constructor(client: RDXClient, dispatch: Dispatch, namespace?: string) {
    super();
    // Nerdctl does not support volume events; set up polling instead.
    this.interval = setInterval(() => dispatch('fetchVolumes'), 2_000);
    // But we still want a filter for namespaces
    this.subscription = client.docker.rdSubscribeToEvents(
      (event) => {
        const topic: string = (event as any).Topic;
        if (topic.startsWith('/namespaces/')) {
          dispatch('fetchNamespaces');
        }
      },
      { namespace: '_' }, // Use an invalid namespace to filter out most events.
    );
  }

  override destroy() {
    clearInterval(this.interval);
    super.destroy();
  }
}

function subscriberConstructor(backend: ValidContainerEngine, type: SubscriberType): SubscriberConstructor {
  return {
    'moby:containers':       MobyContainerSubscriber,
    'moby:volumes':          MobyVolumeSubscriber,
    'containerd:containers': NerdctlContainerSubscriber,
    'containerd:volumes':    NerdctlVolumeSubscriber,
  }[`${ backend }:${ type }` as const];
}

export interface ContainersState {
  /** The backend in use; this may not match the committed preferences. */
  backend:    ContainerEngine;
  /** The type of object to monitor. */
  type:       SubscriberType;
  client:     RDXClient | null;
  namespaces: string[] | null;
  namespace:  string | undefined;
  subscriber: Subscriber | null;
  containers: Record<string, Container> | null;
  volumes:    Record<string, Volume> | null;
}

export const state: () => ContainersState = () => ({
  backend:    ContainerEngine.NONE,
  type:       'containers',
  client:     null,
  namespaces: null,
  namespace:  undefined,
  subscriber: null,
  containers: null,
  volumes:    null,
});

type BulkParams = Pick<ContainersState, 'backend' | 'type' | 'client' | 'namespace'>;

export const mutations = {
  SET_SUBSCRIBER(state, subscriber) {
    state.subscriber?.destroy();
    state.subscriber = subscriber;
  },
  SET_NAMESPACES(state, namespaces) {
    state.namespaces = Array.isArray(namespaces) ? namespaces.sort() : namespaces;
  },
  SET_CONTAINERS(state, containers) {
    state.containers = containers;
  },
  SET_VOLUMES(state, volumes) {
    state.volumes = volumes;
  },
  SET_PARAMS(state, params: BulkParams) {
    let clearData = false;
    switch (true) {
    case params.backend !== state.backend:
    case params.type !== state.type:
    case params.client === null:
      clearData = true;
    }
    if (clearData) {
      state.namespaces = null;
    }
    if (clearData || params.namespace !== state.namespace) {
      state.subscriber?.destroy();
    }
    Object.assign(state, params);
    if (clearData || params.namespace !== state.namespace) {
      state.subscriber = null;
      state.containers = null;
      state.volumes = null;
    }
  },
} satisfies Partial<MutationsType<ContainersState>> & MutationTree<ContainersState>;

type SubscribeParams = Omit<BulkParams, 'backend' | 'namespace'> & Partial<Pick<BulkParams, 'namespace'>>;

export const actions = {
  async subscribe({ commit, state, dispatch, getters }, params: SubscribeParams) {
    state.subscriber?.destroy();
    commit('SET_PARAMS', { ...params, backend: getters.backend, namespace: params.namespace ?? getters.namespace });
    if (state.backend === ContainerEngine.NONE) {
      return;
    }
    const constructor = subscriberConstructor(state.backend, state.type);
    if (state.client) {
      commit('SET_SUBSCRIBER', new constructor(state.client, dispatch, state.namespace));
      const type = state.type.replace(/^(.)/, c => c.toUpperCase()) as Capitalize<SubscriberType>;
      const tasks = [dispatch(`fetch${ type }`)];

      if (getters.supportsNamespaces) {
        tasks.push(dispatch('fetchNamespaces'));
      }
      await Promise.all(tasks);
    } else {
      commit('SET_SUBSCRIBER', null);
    }
  },
  unsubscribe({ state }) {
    state.subscriber?.destroy();
    state.subscriber = null;
  },
  async fetchNamespaces({ commit, state, getters }) {
    const { client } = state;

    if (!getters.supportsNamespaces) {
      commit('SET_NAMESPACES', null);
      return;
    }

    commit('SET_NAMESPACES', await client?.docker.listNamespaces());
  },
  async fetchContainers({ commit, getters, state }) {
    const { backend, client, namespace } = state;
    const containers = state.containers ?? {};
    const options = { all: true, namespace: getters.supportsNamespaces ? namespace : undefined };
    const apiContainers = await client?.docker.listContainers(options) ?? [];
    const ids = new Set<string>();

    // Update containers in-place to maintain any UI state
    for (const container of apiContainers as (NerdctlContainer | MobyContainer)[]) {
      /** isContainerd is used to cast the container info to the correct type. */
      function isContainerd(container: NerdctlContainer | MobyContainer): container is NerdctlContainer {
        return backend === ContainerEngine.CONTAINERD;
      }

      const k8sPodName = container.Labels?.['io.kubernetes.pod.name'];
      const k8sNamespace = container.Labels?.['io.kubernetes.pod.namespace'];
      const composeProject = container.Labels?.['com.docker.compose.project'];
      let state = container.State;
      let projectGroup = 'Standalone Containers';

      if (k8sPodName && k8sNamespace) {
        projectGroup = `${ k8sNamespace }/${ k8sPodName }`;
      } else if (composeProject) {
        projectGroup = composeProject;
      }

      if (!state) {
        // For containerd, stopped containers may have no state; try status.
        state = container.Status.split(/\s+/)[0].toLowerCase() as any || 'exited';
      }

      const info: Container = {
        id:            container.Id,
        containerName: container.Names[0].replace(/_[a-z0-9-]{36}_[0-9]+/, ''),
        imageName:     container.Image,
        state,
        uptime:        '',
        labels:        container.Labels ?? {},
        ports:         container.Ports,
        projectGroup,
      };

      if (!isContainerd(container)) {
        if (container.State === 'running') {
          info.uptime = container.Status;
        }
      }
      containers[container.Id] = merge(containers[container.Id] ?? {}, info);
      ids.add(container.Id);
    }
    // Remove containers that no longer exist
    for (const id of Object.keys(containers)) {
      if (!ids.has(id)) {
        delete containers[id];
      }
    }
    commit('SET_CONTAINERS', containers);
  },
  async fetchVolumes({ commit, getters, state }) {
    const { client, namespace } = state;
    const volumes = state.volumes ?? {};
    const names = new Set<string>();
    const options = { namespace: getters.supportsNamespaces ? namespace : undefined };

    // Update volumes in-place to maintain any UI state.
    for (const volume of await client?.docker.rdListVolumes(options) ?? []) {
      volumes[volume.Name] = Object.assign(volumes[volume.Name] ?? {}, volume);
      names.add(volume.Name);
    }
    // Remove volumes that no longer exist
    for (const name of Object.keys(volumes)) {
      if (!names.has(name)) {
        delete volumes[name];
      }
    }
    commit('SET_VOLUMES', volumes);
  },
} satisfies ActionTree<ContainersState, any, typeof mutations, typeof getters>;

export const getters = {
  backend(_state, _getters, rootState): ContainerEngine {
    return rootState.preferences.initialPreferences?.containerEngine?.name ?? ContainerEngine.NONE;
  },
  supportsNamespaces(state) {
    return state.backend === ContainerEngine.CONTAINERD;
  },
  namespace(_state, _getters, rootState): string | undefined {
    return rootState.preferences.initialPreferences?.containers?.namespace;
  },
} satisfies GetterTree<ContainersState, any>;
