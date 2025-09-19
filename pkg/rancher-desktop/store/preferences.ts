import _ from 'lodash';

import { ActionContext, ActionTree, MutationsType } from './ts-helpers';

import { CURRENT_SETTINGS_VERSION, defaultSettings, Settings, LockedSettingsType } from '@pkg/config/settings';
import type { ServerState } from '@pkg/main/commandServer/httpCommandServer';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';
import { RecursiveKeys, RecursivePartial, RecursiveTypes } from '@pkg/utils/typeUtils';

import type { GetterTree, MutationTree } from 'vuex';

interface Severities {
  reset:   boolean;
  restart: boolean;
  error:   boolean;
}

interface PreferencesState {
  initialPreferences: Settings;
  preferences:        Settings;
  lockedPreferences:  LockedSettingsType;
  wslIntegrations:    Record<string, string | boolean>;
  isPlatformWindows:  boolean;
  hasError:           boolean;
  severities:         Severities;
  preferencesError:   string;
  canApply:           boolean;
}

type Credentials = Omit<ServerState, 'pid'>;

interface CommitArgs {
  payload?: RecursivePartial<Settings>;
}

const uri = (port: number, path: string) => `http://localhost:${ port }/v1/${ path }`;

const proposedSettings = (port: number) => uri(port, 'propose_settings');

const settingsUri = (port: number) => uri(port, 'settings');

const lockedUri = (port: number) => uri(port, 'settings/locked');

/**
 * Normalize WSL integrations configuration.
 * @param integrations The source collection, containing all WSL integrations.
 * @param mode How normalization should take place.
 *    'diff': Normalize for comparing to see if changes need to be applied.
 *    'submit': Normalize for submitting preferences.
 * @returns Returns a new object with normalized WSL configuration.
 */
const normalizeWslIntegrations = (integrations: Record<string, boolean>, mode: 'diff' | 'submit') => {
  const normalizeFn = {
    diff:   (entries: [string, boolean][]) => entries.filter(([, v]) => v),
    submit: (entries: [string, boolean][]) => entries.map(([k, v]) => [k, v || null] as const),
  }[mode];

  return Object.fromEntries(normalizeFn(Object.entries(integrations)));
};

/**
 * Normalizes preferences for consistent usage between API and UI
 * @param preferences The preferences object to normalize.
 * @param mode How the preferences should be normalized.
 * @returns Returns a new object, containing normalized preferences data.
 */
const normalizePreferences = (preferences: Settings, mode: 'diff' | 'submit') => {
  return {
    ...preferences,
    WSL: {
      ...preferences.WSL,
      integrations: normalizeWslIntegrations(preferences.WSL.integrations, mode),
    },
  };
};

export const state: () => PreferencesState = () => (
  {
    initialPreferences: _.cloneDeep(defaultSettings),
    preferences:        _.cloneDeep(defaultSettings),
    lockedPreferences:  { },
    wslIntegrations:    { },
    isPlatformWindows:  false,
    hasError:           false,
    severities:         {
      reset: false, restart: false, error: false,
    },
    preferencesError: '',
    canApply:         false,
  }
);

export const mutations = {
  SET_PREFERENCES(state, preferences) {
    state.preferences = preferences;
    state.canApply = false;
  },
  SET_INITIAL_PREFERENCES(state, preferences) {
    state.initialPreferences = preferences;
  },
  SET_LOCKED_PREFERENCES(state, preferences) {
    state.lockedPreferences = preferences;
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
  SET_CAN_APPLY(state, canApply) {
    state.canApply = canApply;
  },
} satisfies Partial<MutationsType<PreferencesState>> & MutationTree<PreferencesState>;

type PrefActionContext = ActionContext<PreferencesState, typeof mutations>;
interface ProposePreferencesPayload { preferences?: Settings }

export const actions = {
  setPreferences({ commit }, preferences: Settings) {
    commit('SET_PREFERENCES', _.cloneDeep(preferences));
  },
  initializePreferences({ commit }, preferences: Settings) {
    commit('SET_PREFERENCES', _.cloneDeep(preferences));
    commit('SET_INITIAL_PREFERENCES', _.cloneDeep(preferences));
  },
  async fetchPreferences({ dispatch, commit, rootState }) {
    const { port, user, password } = rootState.credentials.credentials;

    const response = await fetch(
      settingsUri(port),
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
  async fetchLocked({ commit, rootState }) {
    const { port, user, password } = rootState.credentials.credentials;

    const response = await fetch(
      lockedUri(port),
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

    commit('SET_LOCKED_PREFERENCES', settings);
  },
  async commitPreferences({ dispatch, getters, rootState }, args: CommitArgs = {}) {
    const { port, user, password } = rootState.credentials.credentials;
    const { payload } = args;

    await fetch(
      settingsUri(port),
      {
        method:  'PUT',
        headers: new Headers({
          Authorization:  `Basic ${ window.btoa(`${ user }:${ password }`) }`,
          'Content-Type': 'application/x-www-form-urlencoded',
        }),
        body: JSON.stringify(payload ?? normalizePreferences(getters.getPreferences, 'submit')),
      });

    await dispatch('preferences/fetchPreferences', {}, { root: true });
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
  }: PrefActionContext, args: { property: P, value: RecursiveTypes<Settings>[P] }): Promise<void> {
    const { property, value } = args;

    commit('SET_PREFERENCES', _.set(_.cloneDeep(state.preferences), property, value));

    await dispatch(
      'preferences/proposePreferences',
      { ...rootState.credentials.credentials as Credentials },
      { root: true },
    );
  },
  setWslIntegrations({ commit, state }, integrations: Record<string, string | boolean>) {
    /**
     * Merge integrations if they exist during initialization.
     *
     * Issue #3232: First-time render of tabs causes the entire DOM tree to
     * refresh, causing Preferences to initialize more than once.
     */
    const updatedIntegrations = _.merge({}, integrations, state.wslIntegrations);

    commit('SET_WSL_INTEGRATIONS', updatedIntegrations);
  },
  updateWslIntegrations({ commit, state }, args: { distribution: string, value: boolean }) {
    const { distribution, value } = args;

    const integrations = _.set(_.cloneDeep(state.wslIntegrations), distribution, value);

    commit('SET_WSL_INTEGRATIONS', integrations);
  },
  setPlatformWindows({ commit }, isPlatformWindows: boolean) {
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
   * associated with the preferences.
   */
  async proposePreferences(
    { commit, state, getters, rootState },
    { preferences }: ProposePreferencesPayload = {},
  ): Promise<Severities> {
    const proposal = preferences ?? normalizePreferences(getters.getPreferences, 'submit');
    const { user, password, port } = rootState.credentials.credentials;

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

    const changes: Record<string, { severity: 'reset' | 'restart' }> = await result.json();
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
  async setShowMuted({ dispatch }, isMuted: boolean) {
    await dispatch(
      'preferences/commitPreferences',
      {
        payload: {
          version:     CURRENT_SETTINGS_VERSION,
          diagnostics: { showMuted: isMuted },
        },
      },
      { root: true },
    );
  },
  setCanApply({ commit }, canApply: boolean) {
    commit('SET_CAN_APPLY', canApply);
  },
} satisfies ActionTree<PreferencesState, any, typeof mutations, typeof getters>;

export const getters = {
  getPreferences(state) {
    return state.preferences;
  },
  isPreferencesDirty(state) {
    const isDirty = !_.isEqual(
      normalizePreferences(state.initialPreferences, 'diff'),
      normalizePreferences(state.preferences, 'diff'),
    );

    ipcRenderer.send('preferences-set-dirty', isDirty);

    return isDirty;
  },
  getWslIntegrations(state) {
    return state.wslIntegrations;
  },
  isPlatformWindows(state) {
    return state.isPlatformWindows;
  },
  hasError(state) {
    return state.hasError;
  },
  canApply(state, getters) {
    return (getters.isPreferencesDirty && state.preferencesError.length === 0) || state.canApply;
  },
  showMuted(state) {
    return state.preferences.diagnostics.showMuted;
  },
  isPreferenceLocked: (state) => (value: string) => {
    return _.get(state.lockedPreferences, value);
  },
} satisfies GetterTree<PreferencesState, any>;
