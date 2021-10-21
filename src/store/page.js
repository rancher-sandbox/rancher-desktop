export const state = () => ({
  title:       '',
  description: '',
  action:      ''
});

export const mutations = {
  setTitle(state, title) {
    state.title = title;
  },
  setDescription(state, description) {
    state.description = description;
  },
  setAction(state, action) {
    state.action = action;
  }
};

export const actions = {
  setHeader({ commit }, { title, description, action }) {
    commit('setTitle', title);
    commit('setDescription', description);
    commit('setAction', action);
  }
};
