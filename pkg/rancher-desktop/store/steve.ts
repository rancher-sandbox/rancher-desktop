import { Plugin } from 'vuex';

import { MutationsType } from './ts-helpers';

import { RootState } from '@pkg/entry/store';
import ipcRenderer from '@pkg/utils/ipcRenderer';

interface SteveState {
  port: number;
}

export const state: () => SteveState = () => (
  {
    port: 0,
  }
);

export const mutations = {
  SET_PORT(state, port) {
    state.port = port;
  },
} satisfies MutationsType<SteveState>;

export const plugins: Plugin<RootState>[] = [
  // Vuex plugin to monitor for Steve port updates.
  function({ commit }) {
    ipcRenderer.on('steve-port', (event, port) => {
      commit('steve/SET_PORT', port);
    });
    ipcRenderer.send('steve-port');
  },
];
