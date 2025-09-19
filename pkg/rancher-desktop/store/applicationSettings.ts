import _ from 'lodash';
import { GetterTree, MutationTree } from 'vuex';

import { ActionTree, MutationsType } from './ts-helpers';

import { defaultSettings } from '@pkg/config/settings';
import type { PathManagementStrategy } from '@pkg/integrations/pathManager';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

/**
 * State is the type of the state we are maintaining in this store.
 */
interface State {
  pathManagementStrategy: PathManagementStrategy;
}

const cfg = _.cloneDeep(defaultSettings);

export const state: () => State = () => {
  // While we load the settings from disk here, we only otherwise interact with
  // the settings only via ipcRenderer.
  return { pathManagementStrategy: cfg.application.pathManagementStrategy };
};

export const mutations = {
  SET_PATH_MANAGEMENT_STRATEGY(state: State, strategy: PathManagementStrategy) {
    state.pathManagementStrategy = strategy;
  },
} satisfies Partial<MutationsType<State>> & MutationTree<State>;

export const actions = {
  setPathManagementStrategy({ commit }, strategy: PathManagementStrategy) {
    commit('SET_PATH_MANAGEMENT_STRATEGY', strategy);
  },
  async commitPathManagementStrategy({ commit }, strategy: PathManagementStrategy) {
    commit('SET_PATH_MANAGEMENT_STRATEGY', strategy);
    cfg.application.pathManagementStrategy = strategy;
    await ipcRenderer.invoke('settings-write', { application: { pathManagementStrategy: strategy } });
  },
} satisfies ActionTree<State, any, typeof mutations, typeof getters>;

export const getters = {
  pathManagementStrategy({ pathManagementStrategy }: State) {
    return pathManagementStrategy;
  },
} satisfies GetterTree<State, any>;
