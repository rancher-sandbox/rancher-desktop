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
  inError: boolean;
}

export const state: () => ExtensionsState = () => ({
  extensions: {},
  inError:    false,
});

export const mutations: MutationsType<ExtensionsState> = {
  SET_EXTENSIONS(state: ExtensionsState, extensions: Record<string, ExtensionState>) {
    state.extensions = extensions;
  },
  SET_IN_ERROR(state: ExtensionsState, status: boolean) {
    state.inError = status;
  },
};

type ExtensionsActionContext = ActionContext<ExtensionsState>;

export const actions = {
  async fetch({ commit, rootState }: ExtensionsActionContext) {
    const response = await fetchAPI('/v1/extensions', rootState);

    if (!response.ok) {
      console.log(`fetchExtensions: failed: status: ${ response.status }:${ response.statusText }`);
      commit('SET_IN_ERROR', true);

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
