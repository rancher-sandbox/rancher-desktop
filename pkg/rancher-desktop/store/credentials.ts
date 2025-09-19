import { MutationTree } from 'vuex/types';

import { ActionTree, MutationsType } from './ts-helpers';

import type { ServerState } from '@pkg/main/commandServer/httpCommandServer';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';
import Latch from '@pkg/utils/latch';

export type Credentials = Omit<ServerState, 'pid'>;

interface CredentialsState {
  credentials: Credentials;
}

const hasCredentials = Latch();

export async function fetchAPI(api: string, rootState: any, init?: RequestInit) {
  // Any fetches will block until we have credentials.
  await hasCredentials;

  const { port, user, password } = rootState.credentials.credentials as Credentials;
  const url = new URL(api, `http://localhost:${ port }/`);
  const headers = new Headers(init?.headers);

  headers.set('Authorization', `Basic ${ window.btoa(`${ user }:${ password }`) }`);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/x-www-form-urlencoded');
  }

  init ??= {};
  init.headers = headers;

  return fetch(url.toString(), init);
}

export const state: () => CredentialsState = () => (
  {
    credentials: {
      password: '',
      port:     0,
      user:     '',
    },
  }
);

export const mutations = {
  SET_CREDENTIALS(state, credentials) {
    state.credentials = credentials;
    hasCredentials.resolve();
  },
} satisfies Partial<MutationsType<CredentialsState>> & MutationTree<CredentialsState>;

export const actions = {
  async fetchCredentials({ commit }): Promise<Credentials> {
    const result = await ipcRenderer.invoke('api-get-credentials');

    commit('SET_CREDENTIALS', result);

    return result;
  },
} satisfies ActionTree<CredentialsState, any, typeof mutations>;
