import { ipcRenderer } from 'electron';

import { ActionContext, MutationsType } from './ts-helpers';

import type { ServerState } from '@/main/commandServer/httpCommandServer';

interface CredentialsState {
  credentials: ServerState;
}

export const state: () => CredentialsState = () => (
  {
    credentials: {
      password: '',
      pid:      0,
      port:     0,
      user:     ''
    }
  }
);

export const mutations: MutationsType<CredentialsState> = {
  SET_CREDENTIALS(state, credentials) {
    state.credentials = credentials;
  }
};

type CredActionContext = ActionContext<CredentialsState>;

export const actions = {
  async fetchCredentials({ commit }: CredActionContext) {
    const result = await ipcRenderer.invoke('api-get-credentials');

    commit('SET_CREDENTIALS', result);

    return result;
  }
};
