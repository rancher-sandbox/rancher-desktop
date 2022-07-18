import type { GetterTree, MutationTree, ActionTree } from 'vuex';
import { ipcRenderer } from 'electron';
import _ from 'lodash';

import { defaultSettings, Settings } from '@/config/settings';

interface PreferencesState {
  initialPreferences: Settings;
  preferences: Settings;
  wslIntegrations: Record<string, boolean | string>;
  isPlatformWindows: boolean;
  hasError: boolean;
}

const uri = (port: number) => `http://localhost:${ port }/v0/settings`;

export const state = () => (
  {
    initialPreferences: _.cloneDeep(defaultSettings),
    preferences:        _.cloneDeep(defaultSettings),
    wslIntegrations:    { },
    isPlatformWindows:  false,
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
  SET_WSL_INTEGRATIONS(state, integrations) {
    state.wslIntegrations = integrations;
  },
  SET_PLATFORM_WINDOWS(state, isPlatformWindows) {
    state.isPlatformWindows = isPlatformWindows;
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

    const settings: Settings = await response.json();

    dispatch('preferences/initializePreferences', settings, { root: true });
  },
  async commitPreferences({ state, dispatch }, args: {port: number, user: string, password: string}) {
    const { port, user, password } = args;

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
      'preferences/fetchPreferences',
      {
        port, user, password
      },
      { root: true });
  },
  updatePreferencesData({ commit, state }, { property, value }) {
    commit('SET_PREFERENCES', _.set(_.cloneDeep(state.preferences), property, value));
  },
  setWslIntegrations({ commit }, integrations) {
    commit('SET_WSL_INTEGRATIONS', integrations);
  },
  updateWslIntegrations({ commit, state }, { property, value }) {
    commit('SET_WSL_INTEGRATIONS', _.set(_.cloneDeep(state.wslIntegrations), property, value));
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
    return state.wslIntegrations;
  },
  isPlatformWindows(state: PreferencesState) {
    return state.isPlatformWindows;
  },
  hasError(state: PreferencesState) {
    return state.hasError;
  }
};
