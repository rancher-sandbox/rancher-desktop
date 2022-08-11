import { ActionContext, MutationsType } from './ts-helpers';

interface PageState {
  title: string;
  description: string;
  action: string;
}

export const state: () => PageState = () => ({
  title:       '',
  description: '',
  action:      '',
});

export const mutations: MutationsType<PageState> = {
  SET_TITLE(state, title) {
    state.title = title;
  },
  SET_DESCRIPTION(state, description) {
    state.description = description;
  },
  SET_ACTION(state, action) {
    state.action = action;
  },
};

type PageActionContext = ActionContext<PageState>;

export const actions = {
  setHeader({ commit }: PageActionContext, args: { title: string, description?: string, action?: string }) {
    const { title, description, action } = args;

    commit('SET_TITLE', title);
    commit('SET_DESCRIPTION', description ?? '');
    commit('SET_ACTION', action ?? '');
  },
  setAction({ commit }: PageActionContext, args: { action: string}) {
    const { action } = args;

    commit('SET_ACTION', action);
  },
};
