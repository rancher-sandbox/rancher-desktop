import type { GetterTree, MutationTree, ActionTree } from 'vuex';
import { ipcRenderer } from 'electron';
import _ from 'lodash';

import { defaultSettings, Settings } from '@/config/settings';

interface PreferencesState {
  initialPreferences: Settings,
  preferences: Settings,
  hasWslIntegrations: boolean,
  isPlatformWindows: boolean
}

const uri = (port: number) => `http://localhost:${ port }/v0/settings`;

export const state = () => (
  {
    initialPreferences: _.cloneDeep(defaultSettings),
    preferences:        _.cloneDeep(defaultSettings),
    hasWslIntegrations: false
  }
);

export const mutations: MutationTree<PreferencesState> = {
  SET_PREFERENCES(state, preferences) {
    state.preferences = preferences;
  },
  SET_INITIAL_PREFERENCES(state, preferences) {
    state.initialPreferences = preferences;
  },
  SET_HAS_WSL_INTEGRATIONS(state, hasIntegrations) {
    state.hasWslIntegrations = hasIntegrations;
  },
  SET_PLATFORM_WINDOWS(state, isPlatformWindows) {
    state.isPlatformWindows = isPlatformWindows;
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
  async fetchPreferences({ dispatch }, { port, user, password }) {
    const response = await fetch(
      uri(port),
      {
        headers: new Headers({
          Authorization:  `Basic ${ window.btoa(`${ user }:${ password }`) }`,
          'Content-Type': 'application/x-www-form-urlencoded'
        })
      });

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
  },
  setWslIntegrations({ commit }, hasIntegrations) {
    commit('SET_HAS_WSL_INTEGRATIONS', hasIntegrations);
  },
  setPlatformWindows({ commit }, isPlatformWindows) {
    commit('SET_PLATFORM_WINDOWS', isPlatformWindows);
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
  getWslIntegrations(state: PreferencesState) {
    return state.hasWslIntegrations;
  },
  isPlatformWindows(state: PreferencesState) {
    return state.isPlatformWindows;
  }
};
