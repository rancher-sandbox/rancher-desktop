import { GetterTree } from 'vuex';

import { fetchAPI } from './credentials';
import { ActionContext, MutationsType } from './ts-helpers';

import MARKETPLACE_DATA from '@pkg/assets/extension-data.yaml';
import type { ExtensionMetadata } from '@pkg/main/extensions/types';

export interface ExtensionState {
  version: string;
  metadata: ExtensionMetadata;
  labels: Record<string, string>;
}

export type ExtensionWithId = ExtensionState & {
  /** The extension id, excluding the version (tag). */
  id: string;
};

interface ExtensionsState {
  extensions: Record<string, ExtensionState>;
}

export interface MarketplaceData {
  slug: string;
  version: string;
  containerd_compatible: boolean;
  labels: Record<string, string>;
  title: string;
  logo: string;
  publisher: string;
  short_description: string;
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

  /**
   * Install an extension by id.
   * @param id The extension id; this should include the tag.
   * @returns Error message, or `true` if extension is installed.
   */
  async install({ rootState, dispatch }: ExtensionsActionContext, { id }: { id: string }) {
    const r = await fetchAPI(`/v1/extensions/install?id=${ id }`, rootState, { method: 'POST' });

    await dispatch('fetch');

    if (!r.ok) {
      return r.statusText;
    }

    return r.status === 201;
  },

  /**
   * Uninstall an extension by id.
   * @param id The extension id; this should _not_ include the tag.
   * @returns Error message, or `true` if extension is uninstall.
   */
  async uninstall({ rootState, dispatch }: ExtensionsActionContext, { id }: { id: string }) {
    const r = await fetchAPI(`/v1/extensions/uninstall?id=${ id }`, rootState, { method: 'POST' });

    await dispatch('fetch');

    if (!r.ok) {
      return r.statusText;
    }

    return r.status === 201;
  },
};

export const getters: GetterTree<ExtensionsState, ExtensionsState> = {
  list(state: ExtensionsState): ExtensionWithId[] {
    return Object.entries(state.extensions).map(([id, info]) => ({ id, ...info }));
  },
  marketData(state: ExtensionsState): MarketplaceData[] {
    return MARKETPLACE_DATA;
  },
};
