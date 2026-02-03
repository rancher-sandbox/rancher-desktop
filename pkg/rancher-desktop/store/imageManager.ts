import { GetterTree, MutationTree } from 'vuex';

import { ActionTree, MutationsType } from './ts-helpers';

interface ImageManagerState {
  imageManagerState: boolean;
}

export const state: () => ImageManagerState = () => ({ imageManagerState: false });

export const mutations = {
  SET_IMAGE_MANAGER_STATE(state: ImageManagerState, imageManagerState: boolean) {
    state.imageManagerState = imageManagerState;
  },
} satisfies Partial<MutationsType<ImageManagerState>> & MutationTree<ImageManagerState>;

export const actions = {
  setImageManagerState({ commit }, imageManagerState: boolean) {
    commit('SET_IMAGE_MANAGER_STATE', imageManagerState);
  },
} satisfies ActionTree<ImageManagerState, any, typeof mutations>;

export const getters = {
  getImageManagerState({ imageManagerState }: ImageManagerState) {
    return imageManagerState;
  },
} satisfies GetterTree<ImageManagerState, any>;
