import { createStore, mapGetters, mapState, ModuleTree, Plugin } from 'vuex';

import * as ActionMenu from '../store/action-menu';
import * as ApplicationSettings from '../store/applicationSettings';
import * as ContainerEngine from '../store/container-engine';
import * as Credentials from '../store/credentials';
import * as Diagnostics from '../store/diagnostics';
import * as Extensions from '../store/extensions';
import * as I18n from '../store/i18n';
import * as ImageManager from '../store/imageManager';
import * as K8sManager from '../store/k8sManager';
import * as Page from '../store/page';
import * as Preferences from '../store/preferences';
import * as Prefs from '../store/prefs';
import * as ResourceFetch from '../store/resource-fetch';
import * as Snapshots from '../store/snapshots';
import * as TransientSettings from '../store/transientSettings';

const modules = {
  'action-menu':       ActionMenu,
  applicationSettings: ApplicationSettings,
  'container-engine':  ContainerEngine,
  credentials:         Credentials,
  diagnostics:         Diagnostics,
  extensions:          Extensions,
  i18n:                I18n,
  imageManager:        ImageManager,
  k8sManager:          K8sManager,
  page:                Page,
  preferences:         Preferences,
  prefs:               Prefs,
  'resource-fetch':    ResourceFetch,
  snapshots:           Snapshots,
  transientSettings:   TransientSettings,
};

export default createStore<any>({
  modules: Object.fromEntries(Object.entries(modules).map(([k, v]) => [k, { namespaced: true, ...v }])),
  plugins: Object.values(modules).flatMap(v => 'plugins' in v ? v.plugins : []),
});

export type Modules = typeof modules;

/**
 * mapTypedGetters is a wrapper around mapGetters that is aware of the types of
 * the Vuex stores we have availabile, and returns the correctly typed values.
 * @see https://vuex.vuejs.org/guide/getters.html#the-mapgetters-helper
 */
// mapTypedGetters('namespace', ['getter', 'getter'])
export function mapTypedGetters
<
  N extends keyof Modules,
  M extends Modules[N] extends { getters: any } ? Modules[N]['getters'] : never,
  K extends keyof M,
>(namespace: N, keys: K[]): { [key in K]: () => ReturnType<M[key]> };
// mapTypedGetters('namespace', {name: newName, name: newName})
export function mapTypedGetters
<
  N extends keyof Modules,
  M extends Modules[N] extends { getters: any } ? Modules[N]['getters'] : never,
  K extends keyof M,
  G extends Record<string, K>,
>(namespace: N, mappings: G): { [key in keyof G]: () => ReturnType<M[G[key]]> };
// Actual implementation defers to mapGetters.
export function mapTypedGetters(namespace: string, arg: any) {
  return mapGetters(namespace, arg);
}

/**
 * mapTypedState is a wrapper around mapState that is aware of the types of the
 * Vuex stores we have available, and returns the correctly typed values.
 * @see https://vuex.vuejs.org/guide/state.html#the-mapstate-helper
 */
// mapTypedState('namespace', ['state', 'state'])
export function mapTypedState
<
  N extends keyof Modules,
  S extends ReturnType<Modules[N]['state']>,
  K extends keyof S,
>(namespace: N, keys: K[]): { [key in K]: () => S[key] };
// mapTypedState('namespace', {key: 'name', key: (state) => (state.key)})
export function mapTypedState
<
  N extends keyof Modules,
  S extends ReturnType<Modules[N]['state']>,
  K extends keyof S,
  G extends Record<string, K | ((state: S) => any)>,
>(namespace: N, mappings: G): {
  [key in keyof G]:
  G[key] extends K ? () => S[G[key]] :
    G[key] extends (state: S) => any ? () => ReturnType<G[key]> :
      never;
};
// Actual implementation defers to mapState
export function mapTypedState(namespace: string, arg: any) {
  return mapState(namespace, arg);
}
