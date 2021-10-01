export const state = () => ({
  title:       '',
  description: ''
});

export const mutations = {
  setTitle(state, title) {
    state.title = title;
  },
  setDescription(state, description) {
    state.description = description;
  }
};

export const actions = {
  setHeader({ commit }, { title, description }) {
    commit('setTitle', title);
    commit('setDescription', description);
  }
};
