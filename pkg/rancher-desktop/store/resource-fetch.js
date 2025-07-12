export const state = function() {
  return {
    refreshFlag:                null,
    isTooManyItemsToAutoUpdate: false,
    manualRefreshIsLoading:     false,
  };
};

export const getters = {
  isTooManyItemsToAutoUpdate: (state) => state.isTooManyItemsToAutoUpdate,
  refreshFlag:                (state) => state.refreshFlag,
  manualRefreshIsLoading:     (state) => state.manualRefreshIsLoading
};

export const mutations = {
  updateIsTooManyItems(state, data) {
    state.isTooManyItemsToAutoUpdate = data;
  },
  updateRefreshFlag(state, data) {
    state.refreshFlag = data;
  },
  updateManualRefreshIsLoading(state, data) {
    state.manualRefreshIsLoading = data;
  },
};

export const actions = {
  clearData({ commit, state }) {
    commit('updateIsTooManyItems', false);
    commit('updateRefreshFlag', null);
  },
  updateIsTooManyItems({ commit }, data) {
    commit('updateIsTooManyItems', data);
  },
  updateManualRefreshIsLoading({ commit }, data) {
    commit('updateManualRefreshIsLoading', data);
  },
  doManualRefresh({ commit, dispatch, state }) {
    // simple change to trigger request on the resource-fetch mixin....
    const finalData = new Date().getTime();

    commit('updateRefreshFlag', finalData);
  },
};
