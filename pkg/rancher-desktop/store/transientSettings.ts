import _ from 'lodash';

import { ActionContext, MutationsType } from './ts-helpers';

import { defaultTransientSettings, TransientSettings } from '@/config/transientSettings';
import type { ServerState } from '@/main/commandServer/httpCommandServer';
import { RecursivePartial } from '@/utils/typeUtils';

import type { GetterTree } from 'vuex';

type Preferences = typeof defaultTransientSettings.preferences;

interface CommitArgs extends ServerState {
  payload?: RecursivePartial<TransientSettings>;
}

const uri = (port: number) => `http://localhost:${ port }/v0/transient_settings`;

export const state: () => TransientSettings = () => _.cloneDeep(defaultTransientSettings);

export const mutations: MutationsType<TransientSettings> = {
  SET_PREFERENCES(state, preferences) {
    state.preferences = preferences;
  },
  SET_NO_MODAL_DIALOGS(state, noModalDialogs) {
    state.noModalDialogs = noModalDialogs;
  },
};

type TransientSettingsContext = ActionContext<TransientSettings>;

export const actions = {
  setPreferences({ commit }: TransientSettingsContext, preferences: Preferences) {
    commit('SET_PREFERENCES', _.cloneDeep(preferences));
  },
  async fetchTransientSettings({ commit }: TransientSettingsContext, args: ServerState) {
    const { port, user, password } = args;

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
  async commitPreferences({ state, dispatch }: TransientSettingsContext, args: CommitArgs) {
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
      'transientSettings/fetchTransientSettings',
      args,
      { root: true });
  },
};

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
