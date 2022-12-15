import { ipcRenderer } from '@pkg/utils/ipcRenderer';

export const state = () => ({ k8sState: ipcRenderer.sendSync('k8s-state') });

export const mutations = {
  SET_K8S_STATE(state, k8sState) {
    state.k8sState = k8sState;
  },
};

export const actions = {
  setK8sState({ commit }, k8sState) {
    commit('SET_K8S_STATE', k8sState);
  },
};

export const getters = {
  getK8sState({ k8sState }) {
    return k8sState;
  },
};
