import DOMPurify from 'dompurify';
import _ from 'lodash';
import { marked } from 'marked';
import { ActionTree, Plugin } from 'vuex';

import { ActionContext, MutationsType } from './ts-helpers';

import { CURRENT_SETTINGS_VERSION } from '@pkg/config/settings';
import type { DiagnosticsResult, DiagnosticsResultCollection } from '@pkg/main/diagnostics/diagnostics';
import ipcRenderer from '@pkg/utils/ipcRenderer';

interface DiagnosticsState {
  diagnostics: DiagnosticsResult[],
  timeLastRun: Date;
  inError:     boolean;
}

const uri = (port: number, pathRemainder: string) => `http://localhost:${ port }/v1/${ pathRemainder }`;

/**
 * Updates the muted property for diagnostic results.
 * @param checks A collection of diagnostic results that require muting.
 * @param mutedChecks A collection of key, value pairs that contains a key of
 * the ID for the diagnostic and a boolean value for muting the result.
 * @returns A collection of diagnostic results with an updated muted property.
 */
function mapMutedDiagnostics(checks: DiagnosticsResult[], mutedChecks: Record<string, boolean>) {
  return checks.map(check => ({ ...check, mute: !!mutedChecks[check.id] }));
};

/**
 * Maps over an array of diagnostic results, applying a markdown transformation
 * to the 'description' property of each object.
 * @param diagnostics The array of diagnostic results to map over.
 * @returns A promise that resolves to the array of diagnostic results with the
 * 'description' property transformed to markdown.
 */
async function mapMarkdownToDiagnostics(diagnostics: DiagnosticsResult[]) {
  return await Promise.all(
    diagnostics.map(async(x) => {
      return {
        ...x,
        description: await markdown(x.description),
      };
    }),
  );
};

/**
 * Processes a raw markdown string by first parsing it with `marked.parseInline`
 * and then sanitizing the result using `DOMPurify`.
 * @param raw The raw markdown string to be processed.
 * @returns A promise that resolves to a sanitized HTML string generated
 * from the provided markdown.
 */
async function markdown(raw: string) {
  const markedString = await marked.parseInline(raw);

  return DOMPurify.sanitize(markedString, { USE_PROFILES: { html: true } });
};

export const state: () => DiagnosticsState = () => (
  {
    diagnostics: [],
    timeLastRun: new Date(),
    inError:     false,
  }
);

export const mutations = {
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
} satisfies MutationsType<DiagnosticsState>;

type DiagActionContext = ActionContext<DiagnosticsState>;

export const actions = {
  async fetchDiagnostics({ commit, rootState }: DiagActionContext) {
    try {
      const { port, user, password } = rootState.credentials.credentials;
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

      commit('SET_DIAGNOSTICS', await mapMarkdownToDiagnostics(checks));
      commit('SET_TIME_LAST_RUN', new Date(result.last_update));
      commit('SET_IN_ERROR', false);
    } catch (ex) {
      console.error(`fetchDiagnostics failed:`, ex);
      commit('SET_IN_ERROR', true);
    }
  },
  async runDiagnostics({ commit, rootState }:DiagActionContext) {
    const { port, user, password } = rootState.credentials.credentials;
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

    commit('SET_DIAGNOSTICS', await mapMarkdownToDiagnostics(checks));
    commit('SET_TIME_LAST_RUN', new Date(result.last_update));
  },
  async updateDiagnostic({
    commit, state, dispatch,
  }: DiagActionContext, { isMuted, row }: { isMuted: boolean, row: DiagnosticsResult }) {
    const diagnostics = _.cloneDeep(state.diagnostics);
    const rowToUpdate = diagnostics.find(x => x.id === row.id);

    if (rowToUpdate === undefined) {
      return;
    }

    rowToUpdate.mute = isMuted;

    await dispatch(
      'preferences/commitPreferences',
      {
        payload: {
          version:     CURRENT_SETTINGS_VERSION,
          diagnostics: { mutedChecks: { [rowToUpdate.id]: isMuted } },
        },
      },
      { root: true },
    );

    commit('SET_DIAGNOSTICS', await mapMarkdownToDiagnostics(diagnostics));
  },
} satisfies ActionTree<DiagnosticsState, any>;

export const plugins: Plugin<DiagnosticsState>[] = [
  // Vuex plugin used to refresh diagnostics on command from the backend.
  function(store) {
    ipcRenderer.on('diagnostics/update', () => {
      store.dispatch('diagnostics/fetchDiagnostics');
    });
  },
];
