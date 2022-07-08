import { ipcRenderer } from 'electron';
import _ from 'lodash';

import { defaultSettings } from '@/config/settings';

export const state = () => (
  {
    initialPreferences: _.cloneDeep(defaultSettings),
    preferences:        _.cloneDeep(defaultSettings)
  }
);

export const mutations = {
  SET_PREFERENCES(state, preferences) {
    state.preferences = preferences;
  },
  SET_INITIAL_PREFERENCES(state, preferences) {
    state.initialPreferences = preferences;
  }
};

export const actions = {
  setPreferences({ commit }, preferences) {
    commit('SET_PREFERENCES', _.cloneDeep(preferences));
  },
  initializePreferences({ commit }, preferences) {
    commit('SET_PREFERENCES', _.cloneDeep(preferences));
    commit('SET_INITIAL_PREFERENCES', _.cloneDeep(preferences));
  },
  commitPreferences({ state }) {
    ipcRenderer.invoke(
      'settings-write',
      state.preferences
    );
  },
  updatePreferencesData({ commit, state }, { property, value }) {
    commit('SET_PREFERENCES', _.set(_.cloneDeep(state.preferences), property, value));
  }
};

export const getters = {
  getPreferences(state) {
    return state.preferences;
  },
  isPreferencesDirty(state) {
    return !_.isEqual(_.cloneDeep(state.initialPreferences), _.cloneDeep(state.preferences));
  }
};
