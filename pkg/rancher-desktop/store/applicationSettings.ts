
import { ActionContext, MutationsType } from './ts-helpers';

import { load as loadSettings } from '@pkg/config/settings';
import type { PathManagementStrategy } from '@pkg/integrations/pathManager';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

/**
 * State is the type of the state we are maintaining in this store.
 */
type State = {
  pathManagementStrategy: PathManagementStrategy;
  sudoAllowed: boolean;
};

export const state: () => State = () => {
  // While we load the settings from disk here, we only otherwise interact with
  // the settings only via ipcRenderer.
  const cfg = loadSettings();

  return {
    pathManagementStrategy: cfg.pathManagementStrategy,
    sudoAllowed:            !cfg.kubernetes.suppressSudo,
  };
};

export const mutations: MutationsType<State> = {
  SET_PATH_MANAGEMENT_STRATEGY(state: State, strategy: PathManagementStrategy) {
    state.pathManagementStrategy = strategy;
  },
  SET_SUDO_ALLOWED(state: State, allowed: boolean) {
    state.sudoAllowed = allowed;
  },
} as const;

type AppActionContext = ActionContext<State>;

export const actions = {
  setPathManagementStrategy({ commit }: AppActionContext, strategy: PathManagementStrategy) {
    commit('SET_PATH_MANAGEMENT_STRATEGY', strategy);
  },
  async commitPathManagementStrategy({ commit }: AppActionContext, strategy: PathManagementStrategy) {
    commit('SET_PATH_MANAGEMENT_STRATEGY', strategy);
    await ipcRenderer.invoke('settings-write', { pathManagementStrategy: strategy });
  },
  setSudoAllowed({ commit, state }: AppActionContext, allowed: boolean) {
    if (allowed !== state.sudoAllowed) {
      commit('SET_SUDO_ALLOWED', allowed);
    }
  },
  async commitSudoAllowed({ commit, state }: AppActionContext, allowed: boolean) {
    if (allowed !== state.sudoAllowed) {
      commit('SET_SUDO_ALLOWED', allowed);
      await ipcRenderer.invoke('settings-write', { kubernetes: { suppressSudo: !allowed } });
    }
  },
};

export const getters = {
  pathManagementStrategy({ pathManagementStrategy }: State) {
    return pathManagementStrategy;
  },
  sudoAllowed({ sudoAllowed }: State) {
    return sudoAllowed;
  },
};
