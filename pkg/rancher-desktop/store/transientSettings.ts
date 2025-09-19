import _ from 'lodash';
import semver from 'semver';

import { ActionContext, MutationsType } from './ts-helpers';

import { defaultTransientSettings, NavItemName, TransientSettings } from '@pkg/config/transientSettings';
import type { ServerState } from '@pkg/main/commandServer/httpCommandServer';
import { RecursivePartial } from '@pkg/utils/typeUtils';

import type { ActionTree, GetterTree } from 'vuex';

type Preferences = typeof defaultTransientSettings.preferences;

interface CommitArgs {
  payload?: RecursivePartial<TransientSettings>;
}

interface NavigatePrefsDialogArgs extends ServerState {
  navItem: NavItemName;
  tab?:    string;
}

type ExtendedTransientSettings = TransientSettings & {
  macOsVersion?: semver.SemVer;
  isArm?:        boolean;
};

const uri = (port: number) => `http://localhost:${ port }/v1/transient_settings`;

export const state: () => ExtendedTransientSettings = () => _.cloneDeep(defaultTransientSettings);

export const mutations: MutationsType<ExtendedTransientSettings> = {
  SET_PREFERENCES(state, preferences) {
    state.preferences = preferences;
  },
  SET_NO_MODAL_DIALOGS(state, noModalDialogs) {
    state.noModalDialogs = noModalDialogs;
  },
  SET_MAC_OS_VERSION(state, macOsVersion) {
    state.macOsVersion = macOsVersion;
  },
  SET_IS_ARM(state, isArm) {
    state.isArm = isArm;
  },
};

export const actions = {
  setPreferences({ commit }, preferences: Preferences) {
    commit('SET_PREFERENCES', _.cloneDeep(preferences));
  },
  async fetchTransientSettings({ commit, rootState }) {
    const { port, user, password } = rootState.credentials.credentials;

    const response = await fetch(
      uri(port),
      {
        headers: new Headers({
          Authorization:  `Basic ${ window.btoa(`${ user }:${ password }`) }`,
          'Content-Type': 'application/x-www-form-urlencoded',
        }),
      });
    const transientSettings: TransientSettings = await response.json();

    commit('SET_PREFERENCES', _.cloneDeep(transientSettings.preferences));
  },
  async commitPreferences({ state, dispatch, rootState }, args: CommitArgs) {
    const { port, user, password } = rootState.credentials.credentials;
    const { payload } = args;

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

    await dispatch('fetchTransientSettings', args);
  },
  async navigatePrefDialog(context, args: NavigatePrefsDialogArgs) {
    const commitArgs = _.omit(args, 'navItem', 'tab');
    const { navItem, tab } = args;
    const preferences = { navItem: { current: navItem, currentTabs: { [navItem]: tab } } };

    await context.dispatch('commitPreferences', { ...commitArgs, payload: { preferences } });
  },
  setMacOsVersion({ commit }, macOsVersion: semver.SemVer) {
    commit('SET_MAC_OS_VERSION', macOsVersion);
  },
  setIsArm({ commit }, isArm: boolean) {
    commit('SET_IS_ARM', isArm);
  },
} satisfies ActionTree<TransientSettings, any>;

export const getters: GetterTree<TransientSettings, TransientSettings> = {
  getPreferences(state: TransientSettings) {
    return state.preferences;
  },
  getNoModalDialogs(state: TransientSettings) {
    return state.noModalDialogs;
  },
  getCurrentNavItem(state: TransientSettings) {
    return state.preferences?.navItem?.current;
  },
  getActiveTab(state: TransientSettings) {
    const currentNavItem = state.preferences?.navItem.current;

    return state.preferences?.navItem?.currentTabs[currentNavItem];
  },
};
