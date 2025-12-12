import semver from 'semver';
import { GetterTree, MutationTree } from 'vuex';

import { fetchAPI } from './credentials';
import { ActionTree, MutationsType } from './ts-helpers';

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

export const mutations = {
  SET_EXTENSIONS(state, extensions: Record<string, ExtensionState>) {
    state.extensions = extensions;
  },
} satisfies Partial<MutationsType<ExtensionsState>> & MutationTree<ExtensionsState>;

export const actions = {
  async fetch({ commit, rootState }) {
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
  async install({ rootState, dispatch }, { id }: { id: string }) {
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
  async uninstall({ rootState, dispatch }, { id }: { id: string }) {
    const r = await fetchAPI(`/v1/extensions/uninstall?id=${ id }`, rootState, { method: 'POST' });

    await dispatch('fetch');

    if (!r.ok) {
      return r.statusText;
    }

    return r.status === 201;
  },
} satisfies ActionTree<ExtensionsState, any, typeof mutations, typeof getters>;

export const getters = {
  installedExtensions(state): ExtensionState[] {
    return Object.values(state.extensions);
  },
  /**
   * Get the welcome extension if configured and installed.
   * @param state Extension state
   * @param _getters Unused
   * @param rootState Root state to access preferences
   */
  welcomeExtension(state, _getters, rootState): ExtensionState | undefined {
    const welcomeId = rootState.preferences?.preferences?.application?.extensions?.welcome;

    if (!welcomeId) {
      return undefined;
    }

    return state.extensions[welcomeId];
  },
  /**
   * Get installed extensions excluding the welcome extension.
   * These are shown in the regular extensions section of the nav.
   */
  regularExtensions(state, _getters, rootState): ExtensionState[] {
    const welcomeId = rootState.preferences?.preferences?.application?.extensions?.welcome;
    const extensions = Object.values(state.extensions);

    if (!welcomeId) {
      return extensions;
    }

    return extensions.filter(ext => ext.id !== welcomeId);
  },
  marketData(): MarketplaceData[] {
    return MARKETPLACE_DATA;
  },
} satisfies GetterTree<ExtensionsState, any>;
