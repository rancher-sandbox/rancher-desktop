import { ActionContext, MutationsType } from './ts-helpers';

interface HelpState {
  url: string;
  tooltip: string | null;
}

export const state: () => HelpState = () => ({
  url:     '',
  tooltip: null,
});

export const mutations: MutationsType<HelpState> = {
  SET_URL(state, url) {
    state.url = url;
  },
  SET_TOOLTIP(state, tooltip) {
    state.tooltip = tooltip;
  },
};

type PageActionContext = ActionContext<HelpState>;

export const actions = {
  setUrl({ commit }: PageActionContext, url: string) {
    commit('SET_URL', url);
  },
};
