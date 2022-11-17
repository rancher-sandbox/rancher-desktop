import { ipcRenderer } from 'electron';
import _ from 'lodash';

import { ActionContext, MutationsType } from './ts-helpers';

import { defaultSettings, Settings } from '@pkg/config/settings';
import type { ServerState } from '@pkg/main/commandServer/httpCommandServer';
import { RecursiveKeys, RecursivePartial, RecursiveTypes } from '@pkg/utils/typeUtils';

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
  preferencesError: string;
}

interface CommitArgs extends ServerState {
  payload?: RecursivePartial<Settings>;
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
    preferencesError: '',
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
  SET_PREFERENCES_ERROR(state, error) {
    state.preferencesError = error;
  },
};

type PrefActionContext = ActionContext<PreferencesState>;
type ProposePreferencesPayload = { port: number, user: string, password: string, preferences?: Settings };

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
  async commitPreferences({ state, dispatch }: PrefActionContext, args: CommitArgs) {
    const {
      port, user, password, payload,
    } = args;

    await fetch(
      uri(port),
      {
        method:  'PUT',
        headers: new Headers({
          Authorization:  `Basic ${ window.btoa(`${ user }:${ password }`) }`,
          'Content-Type': 'application/x-www-form-urlencoded',
        }),
        body: JSON.stringify(payload ?? state.preferences),
      });

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
  async updatePreferencesData<P extends RecursiveKeys<Settings>>({
    commit, dispatch, state, rootState,
  }: PrefActionContext, args: {property: P, value: RecursiveTypes<Settings>[P]}): Promise<void> {
    const { property, value } = args;

    const newPreferences = _.set(_.cloneDeep(state.preferences), property, value);

    await dispatch(
      'preferences/proposePreferences',
      {
        ...rootState.credentials.credentials as ServerState,
        preferences: newPreferences,
      },
      { root: true },
    );
    commit('SET_PREFERENCES', newPreferences);
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
  /**
   * Validates the provided preferences object. Commits SET_SEVERITIES and
   * SET_PREFERENCES_ERROR based on the validation response.
   * @param context The vuex context object
   * @param payload Contains credentials and an
   * optional preferences object. Defaults to preferences stored in state if
   * preferences are not provided.
   * @returns A collection of severities to indicate any errors or side-effects
   * associated with the the preferences.
   */
  async proposePreferences(
    { commit, state }: PrefActionContext,
    {
      port, user, password, preferences,
    }: ProposePreferencesPayload,
  ): Promise<Severities> {
    const proposal = preferences || state.preferences;

    const result = await fetch(
      proposedSettings(port),
      {
        method:  'PUT',
        headers: new Headers({
          Authorization:  `Basic ${ window.btoa(`${ user }:${ password }`) }`,
          'Content-Type': 'application/x-www-form-urlencoded',
        }),
        body: JSON.stringify(proposal),
      });

    if (!result.ok) {
      const severities = { ...state.severities, error: true };

      commit('SET_SEVERITIES', severities);
      commit('SET_PREFERENCES_ERROR', await result.text());

      return severities;
    }

    const changes: Record<string, {severity: 'reset' | 'restart'}> = await result.json();
    const values = Object.values(changes).map(v => v.severity);
    const severities: Severities = {
      reset:   values.includes('reset'),
      restart: values.includes('restart'),
      error:   false,
    };

    commit('SET_SEVERITIES', severities);
    commit('SET_PREFERENCES_ERROR', '');

    return severities;
  },
  async setShowMuted({ dispatch, rootState }: PrefActionContext, isMuted: boolean) {
    await dispatch(
      'preferences/commitPreferences',
      {
        ...rootState.credentials.credentials as ServerState,
        payload: { diagnostics: { showMuted: isMuted } },
      },
      { root: true },
    );
  },
};

export const getters: GetterTree<PreferencesState, PreferencesState> = {
  getPreferences(state: PreferencesState) {
    return state.preferences;
  },
  isPreferencesDirty(state: PreferencesState) {
    const isDirty = !_.isEqual(state.initialPreferences, state.preferences);

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
  canApply(state: PreferencesState, getters) {
    return getters.isPreferencesDirty && state.preferencesError.length === 0;
  },
  showMuted(state: PreferencesState) {
    return state.preferences.diagnostics.showMuted;
  },
};
