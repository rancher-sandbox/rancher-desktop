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
  }
};

export const actions = {
  setPreferences({ commit }, preferences) {
    commit('SET_PREFERENCES', _.cloneDeep(preferences));
  },
  updatePreferencesData({ commit, state }, { property, value }) {
    commit('SET_PREFERENCES', _.set(_.cloneDeep(state.preferences), property, value));
  }
};

export const getters = {
  getPreferences(state) {
    return state.preferences;
  }
};
