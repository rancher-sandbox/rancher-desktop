import { GetterTree } from 'vuex';

import { ActionContext, MutationsType } from './ts-helpers';

import type { ServerState } from '@/main/commandServer/httpCommandServer';
import type { DiagnosticsCheck } from '@/main/diagnostics/diagnostics';

interface DiagnosticsState {
  diagnostics: Array<DiagnosticsCheck>,
  timeLastRun: Date;
  inError: boolean;
}

const uri = (port: number, pathRemainder: string) => `http://localhost:${ port }/v0/${ pathRemainder }`;

export const state: () => DiagnosticsState = () => (
  {
    diagnostics: [],
    timeLastRun: new Date(),
    inError:     false,
  }
);

export const mutations: MutationsType<DiagnosticsState> = {
  SET_DIAGNOSTICS(state: DiagnosticsState, diagnostics: DiagnosticsCheck[]) {
    state.diagnostics = diagnostics;
    state.inError = false;
  },
  SET_TIME_LAST_RUN(state: DiagnosticsState, currentDate: Date) {
    state.timeLastRun = currentDate;
  },
  SET_IN_ERROR(state: DiagnosticsState, status: boolean) {
    state.inError = status;
  },
};

type DiagActionContext = ActionContext<DiagnosticsState>;

export const actions = {
  async fetchDiagnostics({ commit }: DiagActionContext, args: ServerState) {
    const {
      port,
      user,
      password,
    } = args;
    const response = await fetch(
      uri(port, 'diagnostic_checks'),
      {
        headers: new Headers({
          Authorization:  `Basic ${ window.btoa(`${ user }:${ password }`) }`,
          'Content-Type': 'application/x-www-form-urlencoded',
        }),
      });

    if (!response.ok) {
      console.log(`fetchDiagnostics: failed: status: ${ response.status }:${ response.statusText }`);
      commit('SET_IN_ERROR', true);

      return;
    }
    commit('SET_DIAGNOSTICS', (await response.json()) as Array<DiagnosticsCheck>);
    commit('SET_TIME_LAST_RUN', new Date());
  },
};

export const getters: GetterTree<DiagnosticsState, DiagnosticsState> = {
  diagnostics(state: DiagnosticsState) {
    return state.diagnostics;
  },
  timeLastRun(state: DiagnosticsState) {
    return state.timeLastRun;
  },
};
