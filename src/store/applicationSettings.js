import { ipcRenderer } from 'electron';
import * as settings from '@/config/settings';

export const state = () => ({ pathManagementStrategy: initPathManagementStrategy() });

const initPathManagementStrategy = () => settings.init().pathManagementStrategy;

export const mutations = {
  SET_PATH_MANAGEMENT_STRATEGY(state, strategy) {
    state.pathManagementStrategy = strategy;
  }
};

export const actions = {
  setPathManagementStrategy({ commit }, strategy) {
    commit('SET_PATH_MANAGEMENT_STRATEGY', strategy);
  },
  async commitPathManagementStrategy({ commit }, strategy) {
    commit('SET_PATH_MANAGEMENT_STRATEGY', strategy);
    await ipcRenderer.invoke(
      'settings-write',
      { pathManagementStrategy: strategy }
    );
  }
};

export const getters = {
  getPathManagementStrategy({ pathManagementStrategy }) {
    return pathManagementStrategy;
  }
};
