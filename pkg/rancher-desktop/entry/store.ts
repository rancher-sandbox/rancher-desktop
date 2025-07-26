import { createStore, ModuleTree, Plugin } from 'vuex';

import * as ActionMenu from '../store/action-menu';
import * as ApplicationSettings from '../store/applicationSettings';
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

const modules: Record<string, ModuleTree<any> & { plugins?: Plugin<any>[] }> = {
  'action-menu':       ActionMenu,
  applicationSettings: ApplicationSettings,
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
  plugins: Object.values(modules).flatMap(v => v.plugins ?? []),
});
