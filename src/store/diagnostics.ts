import { ActionContext } from './ts-helpers';

import type { ServerState } from '@/main/commandServer/httpCommandServer';
import { DiagnosticsCheck } from '@/main/diagnostics/diagnostics';

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

export const mutations = {
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
  async fetchDiagnostics({ state, commit }: DiagActionContext, args: ServerState) {
    const rows: Array<DiagnosticsCheck> = [];
    const {
      port,
      user,
      password,
    } = args;
    const response = await fetch(
      uri(port, 'diagnostic_categories'),
      {
        headers: new Headers({
          Authorization:  `Basic ${ window.btoa(`${ user }:${ password }`) }`,
          'Content-Type': 'application/x-www-form-urlencoded',
        }),
      });

    if (!response.ok) {
      commit('SET_IN_ERROR', true);

      return;
    }

    const categories: string[] = await response.json();

    for (const category of categories) {
      const response = await fetch(
        uri(port, `diagnostic_ids?category=${ category }`),
        {
          headers: new Headers({
            Authorization:  `Basic ${ window.btoa(`${ user }:${ password }`) }`,
            'Content-Type': 'application/x-www-form-urlencoded',
          }),
        });

      if (!response.ok) {
        commit('SET_IN_ERROR', true);

        return;
      }
      const checkIDs: string[] = await response.json();

      for (const checkID of checkIDs) {
        const response = await fetch(
          uri(port, `diagnostic_checks?category=${ category }&id=${ checkID }`),
          {
            headers: new Headers({
              Authorization:  `Basic ${ window.btoa(`${ user }:${ password }`) }`,
              'Content-Type': 'application/x-www-form-urlencoded',
            }),
          });

        if (!response.ok) {
          commit('SET_IN_ERROR', true);

          return;
        }
        const res = await response.json();

        res.category = category;
        rows.push(res);
      }
    }
    commit('SET_DIAGNOSTICS', rows);
    commit('SET_TIME_LAST_RUN', new Date());
  },
};

export const getters = {
  diagnostics(state: DiagnosticsState) {
    return state.diagnostics;
  },
  timeLastRun(state: DiagnosticsState) {
    return state.timeLastRun;
  },
};
