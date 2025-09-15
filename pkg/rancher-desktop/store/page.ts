import { MutationTree } from 'vuex';

import { ActionTree, MutationsType } from './ts-helpers';

interface PageState {
  title:       string;
  description: string;
  action:      string;
  icon:        string;
}

export const state: () => PageState = () => ({
  title:       '',
  description: '',
  action:      '',
  icon:        '',
});

export const mutations = {
  SET_TITLE(state, title) {
    state.title = title;
  },
  SET_DESCRIPTION(state, description) {
    state.description = description;
  },
  SET_ACTION(state, action) {
    state.action = action;
  },
  SET_ICON(state, icon) {
    state.icon = icon;
  },
} satisfies Partial<MutationsType<PageState>> & MutationTree<PageState>;

export const actions = {
  setHeader({ commit }, args: { title: string, description?: string, action?: string, icon?: string }) {
    const {
      title, description, action, icon,
    } = args;

    commit('SET_TITLE', title);
    commit('SET_DESCRIPTION', description ?? '');
    commit('SET_ACTION', action ?? '');
    commit('SET_ICON', icon ?? '');
  },
  setAction({ commit }, args: { action: string }) {
    const { action } = args;

    commit('SET_ACTION', action);
  },
} satisfies ActionTree<PageState, any, typeof mutations>;
