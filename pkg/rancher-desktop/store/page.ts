import { MutationTree } from 'vuex';

import { ActionTree, MutationsType } from './ts-helpers';

interface PageState {
  title:          string;
  titleKey:       string;
  titleArgs:      Record<string, string>;
  description:    string;
  descriptionKey: string;
  action:         string;
  icon:           string;
}

export const state: () => PageState = () => ({
  title:          '',
  titleKey:       '',
  titleArgs:      {},
  description:    '',
  descriptionKey: '',
  action:         '',
  icon:           '',
});

export const mutations = {
  SET_TITLE(state, title) {
    state.title = title;
  },
  SET_TITLE_KEY(state, titleKey) {
    state.titleKey = titleKey;
  },
  SET_TITLE_ARGS(state, titleArgs) {
    state.titleArgs = titleArgs;
  },
  SET_DESCRIPTION(state, description) {
    state.description = description;
  },
  SET_DESCRIPTION_KEY(state, descriptionKey) {
    state.descriptionKey = descriptionKey;
  },
  SET_ACTION(state, action) {
    state.action = action;
  },
  SET_ICON(state, icon) {
    state.icon = icon;
  },
} satisfies Partial<MutationsType<PageState>> & MutationTree<PageState>;

interface SetHeaderArgs {
  title?:          string;
  titleKey?:       string;
  titleArgs?:      Record<string, string>;
  description?:    string;
  descriptionKey?: string;
  action?:         string;
  icon?:           string;
}

export const actions = {
  setHeader({ commit }, args: SetHeaderArgs) {
    if (args.titleKey) {
      commit('SET_TITLE_KEY', args.titleKey);
      commit('SET_TITLE', '');
      commit('SET_TITLE_ARGS', args.titleArgs ?? {});
    } else {
      commit('SET_TITLE', args.title ?? '');
      commit('SET_TITLE_KEY', '');
      commit('SET_TITLE_ARGS', {});
    }
    if (args.descriptionKey) {
      commit('SET_DESCRIPTION_KEY', args.descriptionKey);
      commit('SET_DESCRIPTION', '');
    } else {
      commit('SET_DESCRIPTION', args.description ?? '');
      commit('SET_DESCRIPTION_KEY', '');
    }
    commit('SET_ACTION', args.action ?? '');
    commit('SET_ICON', args.icon ?? '');
  },
  setAction({ commit }, args: { action: string }) {
    const { action } = args;

    commit('SET_ACTION', action);
  },
} satisfies ActionTree<PageState, any, typeof mutations>;
