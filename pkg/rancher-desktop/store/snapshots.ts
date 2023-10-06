import { GetterTree } from 'vuex';

import { fetchAPI } from './credentials';
import { ActionContext, MutationsType } from './ts-helpers';

import { Snapshot } from '@pkg/main/snapshots/types';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

interface SnapshotsState {
  snapshots: Snapshot[]
}

export const state: () => SnapshotsState = () => ({ snapshots: [] });

export const mutations: MutationsType<SnapshotsState> = {
  SET_SNAPSHOTS(state: SnapshotsState, snapshots: Snapshot[]) {
    state.snapshots = snapshots;
  },
};

type SnapshotsActionContext = ActionContext<SnapshotsState>;

export const actions = {
  async fetch({ commit, rootState }: SnapshotsActionContext) {
    const response = await fetchAPI('/v1/snapshots', rootState);

    if (!response.ok) {
      console.log(`fetchSnapshots: failed: status: ${ response.status }:${ response.statusText }`);

      const error = await response.text();

      return error;
    }
    const snapshots: Snapshot[] = await response.json();

    commit('SET_SNAPSHOTS', snapshots.sort((a, b) => b.created.localeCompare(a.created)));
  },

  async create({ rootState, dispatch }: SnapshotsActionContext, snapshot: Snapshot) {
    const body = JSON.stringify(snapshot ?? {});

    const response = await fetchAPI('/v1/snapshots', rootState, { method: 'POST', body });

    if (!response.ok) {
      console.log(`createSnapshot: failed: status: ${ response.status }:${ response.statusText }`);

      const error = await response.text();

      return error;
    }

    await dispatch('fetch');
  },

  async delete({ rootState, dispatch }: SnapshotsActionContext, id: string) {
    const response = await fetchAPI(`/v1/snapshots?id=${ id }`, rootState, { method: 'DELETE' });

    if (!response.ok) {
      console.log(`deleteSnapshot: failed: status: ${ response.status }:${ response.statusText }`);

      const error = await response.text();

      return error;
    }

    await dispatch('fetch');
  },

  async restore({ rootState }: SnapshotsActionContext, id: string) {
    const response = await fetchAPI(`/v1/snapshot/restore?id=${ id }`, rootState, { method: 'POST' });

    if (!response.ok) {
      console.log(`restoreSnapshot: failed: status: ${ response.status }:${ response.statusText }`);

      const error = await response.text();

      return error;
    }
  },
};

export const getters: GetterTree<SnapshotsState, SnapshotsState> = {
  list(state: SnapshotsState) {
    return state.snapshots;
  },
};
