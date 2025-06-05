import { createStore } from 'vuex';

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
import * as Snapshots from '../store/snapshots';
import * as TransientSettings from '../store/transientSettings';

export default createStore<any>({
  modules: {
    'action-menu':       { namespaced: true, ...ActionMenu },
    applicationSettings: { namespaced: true, ...ApplicationSettings },
    credentials:         { namespaced: true, ...Credentials },
    diagnostics:         { namespaced: true, ...Diagnostics },
    extensions:          { namespaced: true, ...Extensions },
    i18n:                { namespaced: true, ...I18n },
    imageManager:        { namespaced: true, ...ImageManager },
    k8sManager:          { namespaced: true, ...K8sManager },
    page:                { namespaced: true, ...Page },
    preferences:         { namespaced: true, ...Preferences },
    prefs:               { namespaced: true, ...Prefs },
    snapshots:           { namespaced: true, ...Snapshots },
    transientSettings:   { namespaced: true, ...TransientSettings },
  },
});
