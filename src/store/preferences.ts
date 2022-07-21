import type { GetterTree } from 'vuex';
import { ipcRenderer } from 'electron';
import _ from 'lodash';

import { ActionContext, MutationsType } from './ts-helpers';
import { defaultSettings, Settings } from '@/config/settings';
import { RecursiveKeys, RecursiveTypes } from '@/utils/typeUtils';

interface PreferencesState {
  initialPreferences: Settings;
  preferences: Settings;
  wslIntegrations: { [distribution: string]: string | boolean};
  isPlatformWindows: boolean;
  hasError: boolean;
}

const uri = (port: number) => `http://localhost:${ port }/v0/settings`;

export const state: () => PreferencesState = () => (
  {
    initialPreferences: _.cloneDeep(defaultSettings),
    preferences:        _.cloneDeep(defaultSettings),
    wslIntegrations:    { },
    isPlatformWindows:  false,
    hasError:           false
  }
);

export const mutations: MutationsType<PreferencesState> = {
  SET_PREFERENCES(state, preferences) {
    state.preferences = preferences;
  },
  SET_INITIAL_PREFERENCES(state, preferences) {
    state.initialPreferences = preferences;
  },
  SET_WSL_INTEGRATIONS(state, integrations) {
    state.wslIntegrations = integrations;
  },
  SET_IS_PLATFORM_WINDOWS(state, isPlatformWindows) {
    state.isPlatformWindows = isPlatformWindows;
  },
  SET_HAS_ERROR(state, hasError) {
    state.hasError = hasError;
  }
};

type PrefActionContext = ActionContext<PreferencesState>;

export const actions = {
  setPreferences({ commit }: PrefActionContext, preferences: Settings) {
    commit('SET_PREFERENCES', _.cloneDeep(preferences));
  },
  initializePreferences({ commit }: PrefActionContext, preferences: Settings) {
    commit('SET_PREFERENCES', _.cloneDeep(preferences));
    commit('SET_INITIAL_PREFERENCES', _.cloneDeep(preferences));
  },
  async fetchPreferences({ dispatch, commit }: PrefActionContext, args: { port: number, user: string, password: string}) {
    const { port, user, password } = args;
    const response = await fetch(
      uri(port),
      {
        headers: new Headers({
          Authorization:  `Basic ${ window.btoa(`${ user }:${ password }`) }`,
          'Content-Type': 'application/x-www-form-urlencoded'
        })
      });

    if (!response.ok) {
      commit('SET_HAS_ERROR', true);

      return;
    }

    const settings: Settings = await response.json();

    dispatch('preferences/initializePreferences', settings, { root: true });
  },
  async commitPreferences({ state, dispatch }: PrefActionContext, args: {port: number, user: string, password: string}) {
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

  updatePreferencesData<P extends RecursiveKeys<Settings>>({ commit, state }: PrefActionContext, args: {property: P, value: RecursiveTypes<Settings>[P]}) {
    const { property, value } = args;

    commit('SET_PREFERENCES', _.set(_.cloneDeep(state.preferences), property, value));
  },
  setWslIntegrations({ commit }: PrefActionContext, integrations: { [distribution: string]: string | boolean}) {
    commit('SET_WSL_INTEGRATIONS', integrations);
  },
  updateWslIntegrations({ commit, state }: PrefActionContext, args: {distribution: string, value: boolean}) {
    const { distribution, value } = args;

    commit('SET_WSL_INTEGRATIONS', _.set(_.cloneDeep(state.wslIntegrations), distribution, value));
  },
  setPlatformWindows({ commit }: PrefActionContext, isPlatformWindows: boolean) {
    commit('SET_IS_PLATFORM_WINDOWS', isPlatformWindows);
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
