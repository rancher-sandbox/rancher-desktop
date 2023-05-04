import { GetterTree } from 'vuex';

import { fetchAPI } from './credentials';
import { ActionContext, MutationsType } from './ts-helpers';

import type { ExtensionMetadata } from '@pkg/main/extensions/types';

interface ExtensionState {
  version: string;
  metadata: ExtensionMetadata;
  labels: Record<string, string>;
}

interface ExtensionsState {
  extensions: Record<string, ExtensionState>;
}

export const state: () => ExtensionsState = () => ({ extensions: {} });

export const mutations: MutationsType<ExtensionsState> = {
  SET_EXTENSIONS(state: ExtensionsState, extensions: Record<string, ExtensionState>) {
    state.extensions = extensions;
  },
};

type ExtensionsActionContext = ActionContext<ExtensionsState>;

export const actions = {
  async fetch({ commit, rootState }: ExtensionsActionContext) {
    const response = await fetchAPI('/v1/extensions', rootState);

    if (!response.ok) {
      console.log(`fetchExtensions: failed: status: ${ response.status }:${ response.statusText }`);

      return;
    }
    const result: Record<string, ExtensionState> = await response.json();

    commit('SET_EXTENSIONS', result);
  },
};

export const getters: GetterTree<ExtensionsState, ExtensionsState> = {
  list(state: ExtensionsState): ({ id: string } & ExtensionState )[] {
    return Object.entries(state.extensions).map(([id, info]) => ({ id, ...info }));
  },
};
