import _ from 'lodash';
import { GetterTree } from 'vuex';

import { ActionContext, MutationsType } from './ts-helpers';

import type { ServerState } from '@/main/commandServer/httpCommandServer';
import type { DiagnosticsResult, DiagnosticsResultCollection } from '@/main/diagnostics/diagnostics';

interface DiagnosticsState {
  diagnostics: Array<DiagnosticsResult>,
  timeLastRun: Date;
  inError: boolean;
}

const uri = (port: number, pathRemainder: string) => `http://localhost:${ port }/v0/${ pathRemainder }`;

/**
 * Updates the muted property for diagnostic results.
 * @param checks A collection of diagnostic results that require muting.
 * @param mutedChecks A collection of key, value pairs that contains a key of
 * the ID for the diagnostic and a boolean value for muting the result.
 * @returns A collection of diagnostic results with an updated muted property.
 */
const mapMutedDiagnostics = (checks: DiagnosticsResult[], mutedChecks: any) => {
  return checks.map((check) => {
    if (Object.keys(mutedChecks).includes(check.id)) {
      check.mute = mutedChecks[check.id];
    }

    return check;
  });
};

export const state: () => DiagnosticsState = () => (
  {
    diagnostics: [],
    timeLastRun: new Date(),
    inError:     false,
  }
);

export const mutations: MutationsType<DiagnosticsState> = {
  SET_DIAGNOSTICS(state: DiagnosticsState, diagnostics: DiagnosticsResult[]) {
    state.diagnostics = diagnostics.filter(result => !result.passed);
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
  async fetchDiagnostics({ commit, rootState }: DiagActionContext, args: ServerState) {
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
    const result: DiagnosticsResultCollection = await response.json();

    const mutedChecks = rootState.preferences.preferences.diagnostics.mutedChecks;
    const checks = mapMutedDiagnostics(result.checks, mutedChecks);

    commit('SET_DIAGNOSTICS', checks);
    commit('SET_TIME_LAST_RUN', new Date(result.last_update));
  },
  async runDiagnostics({ commit, rootState }:DiagActionContext, credentials: ServerState) {
    const { port, user, password } = credentials;
    const response = await fetch(
      uri(port, 'diagnostic_checks'),
      {
        headers: new Headers({
          Authorization:  `Basic ${ window.btoa(`${ user }:${ password }`) }`,
          'Content-Type': 'application/x-www-form-urlencoded',
        }),
        method: 'POST',
      });

    if (!response.ok) {
      console.log(`runDiagnostics: failed: status: ${ response.status }:${ response.statusText }`);
      commit('SET_IN_ERROR', true);

      return;
    }
    const result: DiagnosticsResultCollection = await response.json();

    const mutedChecks = rootState.preferences.preferences.diagnostics.mutedChecks;
    const checks = mapMutedDiagnostics(result.checks, mutedChecks);

    commit('SET_DIAGNOSTICS', checks);
    commit('SET_TIME_LAST_RUN', new Date(result.last_update));
  },
  async updateDiagnostic({
    commit, state, dispatch, rootState,
  }: DiagActionContext, { isMuted, row }: { isMuted: boolean, row: DiagnosticsResult }) {
    const diagnostics = _.cloneDeep(state.diagnostics);
    const rowToUpdate = diagnostics.find(x => x.id === row.id);

    if (rowToUpdate === undefined) {
      return;
    }

    rowToUpdate.mute = isMuted;

    console.debug('DIAGNOSTICS', {
      rowToUpdate, diagnostics, rootState,
    });

    await dispatch(
      'preferences/updatePreferencesData',
      {
        property: 'diagnostics.mutedChecks',
        value:    {
          ...rootState.preferences.preferences.diagnostics.mutedChecks,
          [rowToUpdate.id]: isMuted,
        },
      },
      { root: true });
    await dispatch(
      'preferences/commitPreferences',
      rootState.credentials.credentials as ServerState,
      { root: true },
    );

    commit('SET_DIAGNOSTICS', diagnostics);
  },
};

export const getters: GetterTree<DiagnosticsState, DiagnosticsState> = {
  diagnostics(state: DiagnosticsState, _getters) {
    return state.diagnostics;
  },
  timeLastRun(state: DiagnosticsState) {
    return state.timeLastRun;
  },
};
