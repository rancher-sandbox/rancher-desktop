import { ipcRenderer } from 'electron';
import _ from 'lodash';

import { ActionContext, MutationsType } from './ts-helpers';

import { defaultSettings, Settings } from '@/config/settings';
import type { ServerState } from '@/main/commandServer/httpCommandServer';
import { RecursiveKeys, RecursiveTypes } from '@/utils/typeUtils';

import type { GetterTree } from 'vuex';

interface Severities {
  reset: boolean;
  restart: boolean;
  error: boolean;
}

interface PreferencesState {
  initialPreferences: Settings;
  preferences: Settings;
  wslIntegrations: { [distribution: string]: string | boolean};
  isPlatformWindows: boolean;
  hasError: boolean;
  severities: Severities;
}

const uri = (port: number) => `http://localhost:${ port }/v0/settings`;

const proposedSettings = (port: number) => `http://localhost:${ port }/v0/propose_settings`;

export const state: () => PreferencesState = () => (
  {
    initialPreferences: _.cloneDeep(defaultSettings),
    preferences:        _.cloneDeep(defaultSettings),
    wslIntegrations:    { },
    isPlatformWindows:  false,
    hasError:           false,
    severities:         {
      reset: false, restart: false, error: false,
    },
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
  },
  SET_SEVERITIES(state, severities) {
    state.severities = severities;
  },
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
  async fetchPreferences({ dispatch, commit }: PrefActionContext, args: ServerState) {
    const { port, user, password } = args;

    const response = await fetch(
      uri(port),
      {
        headers: new Headers({
          Authorization:  `Basic ${ window.btoa(`${ user }:${ password }`) }`,
          'Content-Type': 'application/x-www-form-urlencoded',
        }),
      });

    if (!response.ok) {
      commit('SET_HAS_ERROR', true);

      return;
    }

    const settings: Settings = await response.json();

    dispatch('preferences/initializePreferences', settings, { root: true });
  },
  async commitPreferences({ state, dispatch }: PrefActionContext, args: ServerState) {
    const { port, user, password } = args;

    const preferences = {
      version:    4,
      kubernetes: {
        version: '', memoryInGB: 2, numberCPUs: 2, port: 6443, containerEngine: 'moby', checkForExistingKimBuilder: false, enabled: false, WSLIntegrations: { Ubuntu: true }, options: { traefik: true, flannel: true }, suppressSudo: false, hostResolver: true,
      },
      portForwarding:         { includeKubernetesServices: false },
      images:                 { showAll: true, namespace: 'k8s.io' },
      telemetry:              true,
      updater:                true,
      debug:                  false,
      pathManagementStrategy: 'notset',
    };

    const response = await fetch(
      uri(port),
      {
        method:  'PUT',
        headers: new Headers({
          Authorization:  `Basic ${ window.btoa(`${ user }:${ password }`) }`,
          'Content-Type': 'application/x-www-form-urlencoded',
        }),
        body: JSON.stringify(state.preferences),
      });

    if (!response.ok) {
      console.debug('FAIL');
    }

    await dispatch(
      'preferences/fetchPreferences',
      args,
      { root: true });
  },

  /**
   * Update a given property for preferences. Propose the new preferences after
   * each update to check if kubernetes requires a reset or restart.
   * @param context The vuex context object
   * @param args Key, value pair that corresponds to a property and its value
   * in the preferences object
   */
  updatePreferencesData<P extends RecursiveKeys<Settings>>({
    commit, dispatch, state, rootState,
  }: PrefActionContext, args: {property: P, value: RecursiveTypes<Settings>[P]}): void {
    const { property, value } = args;

    commit('SET_PREFERENCES', _.set(_.cloneDeep(state.preferences), property, value));
    dispatch(
      'preferences/proposePreferences',
      rootState.credentials.credentials as ServerState,
      { root: true },
    );
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
  },
  async proposePreferences({ commit, state }: PrefActionContext, { port, user, password }: ServerState) {
    const preferences = {
      version:    4,
      kubernetes: {
        version: '', memoryInGB: 2, numberCPUs: 2, port: 6443, containerEngine: 'moby', checkForExistingKimBuilder: false, enabled: false, WSLIntegrations: { Ubuntu: true }, options: { traefik: true, flannel: true }, suppressSudo: false, hostResolver: true,
      },
      portForwarding:         { includeKubernetesServices: false },
      images:                 { showAll: true, namespace: 'k8s.io' },
      telemetry:              true,
      updater:                true,
      debug:                  false,
      pathManagementStrategy: 'notset',
    };

    const result = await fetch(
      proposedSettings(port),
      {
        method:  'PUT',
        headers: new Headers({
          Authorization:  `Basic ${ window.btoa(`${ user }:${ password }`) }`,
          'Content-Type': 'application/x-www-form-urlencoded',
        }),
        body: JSON.stringify(state.preferences),
      });

    if (!result.ok) {
      const severities = { ...state.severities, error: true };

      commit('SET_SEVERITIES', severities);

      return severities;
    }

    const changes: Record<string, {severity: 'reset' | 'restart'}> = await result.json();
    const values = Object.values(changes).map(v => v.severity);
    const severities = {
      reset:   values.includes('reset'),
      restart: values.includes('restart'),
      error:   false,
    };

    commit('SET_SEVERITIES', severities);

    return severities;
  },
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
  },
};
