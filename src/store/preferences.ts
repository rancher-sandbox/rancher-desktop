import type { GetterTree, MutationTree, ActionTree } from 'vuex';
import { ipcRenderer } from 'electron';
import _ from 'lodash';

import { defaultSettings, Settings } from '@/config/settings';

interface PreferencesState {
  initialPreferences: Settings;
  preferences: Settings;
  hasError: boolean;
}

const uri = (port: number) => `http://localhost:${ port }/v0/settings`;

export const state = () => (
  {
    initialPreferences: _.cloneDeep(defaultSettings),
    preferences:        _.cloneDeep(defaultSettings),
    hasError:           false
  }
);

export const mutations: MutationTree<PreferencesState> = {
  SET_PREFERENCES(state, preferences) {
    state.preferences = preferences;
  },
  SET_INITIAL_PREFERENCES(state, preferences) {
    state.initialPreferences = preferences;
  },
  SET_ERROR(state, preferences) {
    state.hasError = true;
  }
};

export const actions: ActionTree<PreferencesState, PreferencesState> = {
  setPreferences({ commit }, preferences) {
    commit('SET_PREFERENCES', _.cloneDeep(preferences));
  },
  initializePreferences({ commit }, preferences) {
    commit('SET_PREFERENCES', _.cloneDeep(preferences));
    commit('SET_INITIAL_PREFERENCES', _.cloneDeep(preferences));
  },
  async fetchPreferences({ dispatch, commit }, { port, user, password }) {
    const response = await fetch(
      uri(port),
      {
        headers: new Headers({
          Authorization:  `Basic ${ window.btoa(`${ user }:${ password }`) }`,
          'Content-Type': 'application/x-www-form-urlencoded'
        })
      });

    if (!response.ok) {
      commit('SET_ERROR', true);

      return;
    }

    dispatch('initializePreferences', await response.json());
  },
  async commitPreferences({ state, dispatch }, { port, user, password }) {
    await fetch(
      uri(port),
      {
        method:  'PUT',
        headers: new Headers({
          Authorization:  `Basic ${ window.btoa(`${ user }:${ password }`) }`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }),
        body: JSON.stringify(state.preferences)
      });

    await dispatch(
      'fetchPreferences',
      {
        port, user, password
      });
  },
  updatePreferencesData({ commit, state }, { property, value }) {
    commit('SET_PREFERENCES', _.set(_.cloneDeep(state.preferences), property, value));
  }
};

export const getters: GetterTree<PreferencesState, PreferencesState> = {
  getPreferences(state: PreferencesState) {
    return state.preferences;
  },
  isPreferencesDirty(state: PreferencesState) {
    const isDirty = !_.isEqual(_.cloneDeep(state.initialPreferences), _.cloneDeep(state.preferences));

    ipcRenderer.send('preferences-set-dirty', isDirty);

    return isDirty;
  },
  hasError(state: PreferencesState) {
    return state.hasError;
  }
};
