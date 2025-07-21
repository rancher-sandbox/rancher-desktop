import semver from 'semver';
import { GetterTree } from 'vuex';

import { fetchAPI } from './credentials';
import { ActionContext, MutationsType } from './ts-helpers';

import MARKETPLACE_DATA from '@pkg/assets/extension-data.yaml';
import type { ExtensionMetadata } from '@pkg/main/extensions/types';

/**
 * BackendExtensionState describes the API response from the API backend.
 * The raw response is a record of slug (i.e. extension ID without version) to
 * this structure.
 */
interface BackendExtensionState {
  /** The installed extension version. */
  version:  string;
  /** Information from the extension's metadata.json. */
  metadata: ExtensionMetadata;
  /** Labels on the extension image. */
  labels:   Record<string, string>;
}

/**
 * ExtensionState describes the data this Vuex store exposes; this is the same
 * as the backend state with the addition of a version available in the catalog.
 */
export type ExtensionState = BackendExtensionState & {
  /** The extension id, excluding the version (tag). Also known as "slug". */
  id:                string;
  /** The version available in the marketplace. */
  availableVersion?: string;
  /** Whether this extension can be upgraded (i.e. availableVersion > version). */
  canUpgrade:        boolean;
};

interface ExtensionsState {
  extensions: Record<string, ExtensionState>;
}

export interface MarketplaceData {
  slug:                  string;
  version:               string;
  containerd_compatible: boolean;
  labels:                Record<string, string>;
  title:                 string;
  logo:                  string;
  publisher:             string;
  short_description:     string;
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
    const backendState: Record<string, BackendExtensionState> = await response.json();
    const result = Object.fromEntries(Object.entries(backendState).map(([id, data]) => {
      const marketplaceEntry = (MARKETPLACE_DATA as MarketplaceData[]).find(ext => ext.slug === id);
      const frontendState: ExtensionState = {
        ...data, id, canUpgrade: false,
      };

      if (marketplaceEntry) {
        frontendState.availableVersion = marketplaceEntry.version;
        try {
          frontendState.canUpgrade = semver.gt(marketplaceEntry.version, data.version);
        } catch {
          // Either existing version or catalog version is invalid; can't upgrade.
        }
      }

      return [id, frontendState];
    }));

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
  installedExtensions(state: ExtensionsState): ExtensionState[] {
    return Object.values(state.extensions);
  },
  marketData(state: ExtensionsState): MarketplaceData[] {
    return MARKETPLACE_DATA;
  },
};
