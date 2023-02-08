
import { ActionContext, MutationsType } from './ts-helpers';

import { load as loadSettings } from '@pkg/config/settings';
import type { PathManagementStrategy } from '@pkg/integrations/pathManager';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

/**
 * State is the type of the state we are maintaining in this store.
 */
type State = {
  pathManagementStrategy: PathManagementStrategy;
  adminAccess: boolean;
};

export const state: () => State = () => {
  // While we load the settings from disk here, we only otherwise interact with
  // the settings only via ipcRenderer.
  const cfg = loadSettings();

  return {
    pathManagementStrategy: cfg.application.pathManagementStrategy,
    adminAccess:            cfg.application.adminAccess,
  };
};

export const mutations: MutationsType<State> = {
  SET_PATH_MANAGEMENT_STRATEGY(state: State, strategy: PathManagementStrategy) {
    state.pathManagementStrategy = strategy;
  },
  SET_ADMIN_ACCESS(state: State, allowed: boolean) {
    state.adminAccess = allowed;
  },
} as const;

type AppActionContext = ActionContext<State>;

export const actions = {
  setPathManagementStrategy({ commit }: AppActionContext, strategy: PathManagementStrategy) {
    commit('SET_PATH_MANAGEMENT_STRATEGY', strategy);
  },
  async commitPathManagementStrategy({ commit }: AppActionContext, strategy: PathManagementStrategy) {
    commit('SET_PATH_MANAGEMENT_STRATEGY', strategy);
    await ipcRenderer.invoke('settings-write', { application: { pathManagementStrategy: strategy } });
  },
  setAdminAccess({ commit, state }: AppActionContext, allowed: boolean) {
    if (allowed !== state.adminAccess) {
      commit('SET_ADMIN_ACCESS', allowed);
    }
  },
  async commitAdminAccess({ commit, state }: AppActionContext, allowed: boolean) {
    if (allowed !== state.adminAccess) {
      commit('SET_ADMIN_ACCESS', allowed);
      await ipcRenderer.invoke('settings-write', { application: { adminAccess: allowed } });
    }
  },
};

export const getters = {
  pathManagementStrategy({ pathManagementStrategy }: State) {
    return pathManagementStrategy;
  },
  adminAccess({ adminAccess }: State) {
    return adminAccess;
  },
};
