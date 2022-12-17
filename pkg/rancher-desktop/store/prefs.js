
import Vue from 'vue';

import { SETTING } from '@pkg/config/settings';
import { MANAGEMENT, STEVE } from '@pkg/config/types';
import { clone } from '@pkg/utils/object';

const definitions = {};

export const create = function(name, def, opt = {}) {
  const parseJSON = opt.parseJSON === true;
  const asCookie = opt.asCookie === true;
  const asUserPreference = opt.asUserPreference !== false;
  const options = opt.options;

  definitions[name] = {
    def,
    options,
    parseJSON,
    asCookie,
    asUserPreference,
    mangleRead:  opt.mangleRead, // Alter the value read from the API (to match old Rancher expectations)
    mangleWrite: opt.mangleWrite, // Alter the value written back to the API (ditto)
  };

  return name;
};

export const mapPref = function(name) {
  return {
    get() {
      return this.$store.getters['prefs/get'](name);
    },

    set(value) {
      this.$store.dispatch('prefs/set', { key: name, value });
    },
  };
};

// --------------------
const parseJSON = true; // Shortcut for setting it below
const asCookie = true; // Store as a cookie so that it's available before auth + on server-side

// Keys must be lowercase and valid dns label (a-z 0-9 -)
export const CLUSTER = create('cluster', '');
export const LAST_NAMESPACE = create('last-namespace', '');
export const NAMESPACE_FILTERS = create('ns', ['all://user'], { parseJSON });
export const WORKSPACE = create('workspace', '');
export const EXPANDED_GROUPS = create('open-groups', ['cluster', 'rbac', 'serviceDiscovery', 'storage', 'workload'], { parseJSON });
export const FAVORITE_TYPES = create('fav-type', [], { parseJSON });
export const GROUP_RESOURCES = create('group-by', 'namespace');
export const DIFF = create('diff', 'unified', { options: ['unified', 'split'] });
export const THEME = create('theme', 'auto', {
  options:     ['light', 'auto', 'dark'],
  asCookie,
  parseJSON,
  mangleRead:  x => x.replace(/^ui-/, ''),
  mangleWrite: x => `ui-${ x }`,
});
export const PREFERS_SCHEME = create('pcs', '', { asCookie, asUserPreference: false });
export const LOCALE = create('locale', 'en-us', { asCookie });
export const KEYMAP = create('keymap', 'sublime', { options: ['sublime', 'emacs', 'vim'] });
export const ROWS_PER_PAGE = create('per-page', 100, { options: [10, 25, 50, 100, 250, 500, 1000], parseJSON });
export const LOGS_WRAP = create('logs-wrap', true, { parseJSON });
export const LOGS_TIME = create('logs-time', true, { parseJSON });
export const LOGS_RANGE = create('logs-range', '30 minutes', { parseJSON });
export const HIDE_REPOS = create('hide-repos', [], { parseJSON });
export const HIDE_DESC = create('hide-desc', [], { parseJSON });
export const HIDE_SENSITIVE = create('hide-sensitive', true, { options: [true, false], parseJSON });
export const SHOW_PRE_RELEASE = create('show-pre-release', false, { options: [false, true], parseJSON });

export const DATE_FORMAT = create('date-format', 'ddd, MMM D YYYY', {
  options: [
    'ddd, MMM D YYYY',
    'ddd, D MMM YYYY',
    'D/M/YYYY',
    'M/D/YYYY',
    'YYYY-MM-DD',
  ],
});

export const TIME_FORMAT = create('time-format', 'h:mm:ss a', {
  options: [
    'h:mm:ss a',
    'HH:mm:ss',
  ],
});

export const TIME_ZONE = create('time-zone', 'local');
export const DEV = create('dev', false, { parseJSON });
export const LAST_VISITED = create('last-visited', 'home', { parseJSON });
export const SEEN_WHATS_NEW = create('seen-whatsnew', '', { parseJSON });
export const READ_WHATS_NEW = create('read-whatsnew', '', { parseJSON });
export const AFTER_LOGIN_ROUTE = create('after-login-route', 'home', { parseJSON } );
export const HIDE_HOME_PAGE_CARDS = create('home-page-cards', {}, { parseJSON } );

export const _RKE1 = 'rke1';
export const _RKE2 = 'rke2';
export const PROVISIONER = create('provisioner', _RKE2, { options: [_RKE1, _RKE2] });

// Promo for Cluster Tools feature on Cluster Dashboard page
export const CLUSTER_TOOLS_TIP = create('hide-cluster-tools-tip', false, { parseJSON });

// Maximum number of clusters to show in the slide-in menu
export const MENU_MAX_CLUSTERS = create('menu-max-clusters', 4, { options: [2, 3, 4, 5, 6, 7, 8, 9, 10], parseJSON });

// --------------------

const cookiePrefix = 'R_';
const cookieOptions = {
  maxAge:   365 * 86400,
  path:     '/',
  sameSite: true,
  secure:   true,
};

export const state = function() {
  return {
    cookiesLoaded: false,
    data:          {},
  };
};

export const getters = {
  get: state => (key) => {
    const definition = definitions[key];

    if (!definition) {
      throw new Error(`Unknown preference: ${ key }`);
    }

    const user = state.data[key];

    if (user !== undefined) {
      return clone(user);
    }

    const def = clone(definition.def);

    return def;
  },

  defaultValue: state => (key) => {
    const definition = definitions[key];

    if (!definition) {
      throw new Error(`Unknown preference: ${ key }`);
    }

    return clone(definition.def);
  },

  options: state => (key) => {
    const definition = definitions[key];

    if (!definition) {
      throw new Error(`Unknown preference: ${ key }`);
    }

    if (!definition.options) {
      throw new Error(`Preference does not have options: ${ key }`);
    }

    return definition.options.slice();
  },

  theme: (state, getters) => {
    let theme = getters['get'](THEME);
    const pcs = getters['get'](PREFERS_SCHEME);

    // console.log('Get Theme', theme, pcs);

    // Ember UI uses this prefix
    if ( theme.startsWith('ui-') ) {
      theme = theme.substr(3);
    }

    if ( theme === 'auto' ) {
      if ( pcs === 'light' || pcs === 'dark' ) {
        return pcs;
      }

      return 'dark';
    }

    return theme;
  },

  afterLoginRoute: (state, getters) => {
    const afterLoginRoutePref = getters['get'](AFTER_LOGIN_ROUTE);

    if (typeof afterLoginRoutePref !== 'string') {
      return afterLoginRoutePref;
    }

    switch (true) {
    case (afterLoginRoutePref === 'home'):
      return { name: 'home' };
    case (afterLoginRoutePref === 'last-visited'): {
      const lastVisitedPref = getters['get'](LAST_VISITED);

      if (lastVisitedPref) {
        return lastVisitedPref;
      }
      const clusterPref = getters['get'](CLUSTER);

      return { name: 'c-cluster-explorer', params: { product: 'explorer', cluster: clusterPref } };
    }
    case (!!afterLoginRoutePref.match(/.+-dashboard$/)):
    {
      const clusterId = afterLoginRoutePref.split('-dashboard')[0];

      return { name: 'c-cluster-explorer', params: { product: 'explorer', cluster: clusterId } };
    }
    default:
      return { name: afterLoginRoutePref };
    }
  },
};

export const mutations = {
  load(state, { key, value }) {
    Vue.set(state.data, key, value);
  },

  cookiesLoaded(state) {
    state.cookiesLoaded = true;
  },
};

export const actions = {
  async set({ dispatch, commit }, opt) {
    let { key, value } = opt; // eslint-disable-line prefer-const
    const definition = definitions[key];
    let server;

    if ( opt.val ) {
      throw new Error('Use value, not val');
    }

    commit('load', { key, value });

    if ( definition.asCookie ) {
      const opt = {
        ...cookieOptions,
        parseJSON: definition.parseJSON === true,
      };

      this.$cookies.set(`${ cookiePrefix }${ key }`.toUpperCase(), value, opt);
    }
    if ( definition.asUserPreference ) {
      try {
        server = await dispatch('loadServer', key); // There's no watch on prefs, so get before set...

        if ( server?.data ) {
          if ( definition.mangleWrite ) {
            value = definition.mangleWrite(value);
          }

          if ( definition.parseJSON ) {
            Vue.set(server.data, key, JSON.stringify(value));
          } else {
            Vue.set(server.data, key, value);
          }

          await server.save({ redirectUnauthorized: false });
        }
      } catch (e) {
        // Well it failed, but not much to do about it...
      }
    }
  },

  async setTheme({ dispatch }, val) {
    await dispatch('set', { key: THEME, value: val });
  },

  loadCookies({ state, commit }) {
    if ( state.cookiesLoaded ) {
      return;
    }

    for (const key in definitions) {
      const definition = definitions[key];

      if ( !definition.asCookie ) {
        continue;
      }

      const opt = { parseJSON: definition.parseJSON === true };
      const value = this.$cookies.get(`${ cookiePrefix }${ key }`.toUpperCase(), opt);

      if (value !== undefined) {
        commit('load', { key, value });
      }
    }

    commit('cookiesLoaded');
  },

  loadTheme({ state, dispatch }) {
    if ( process.client ) {
      const watchDark = window.matchMedia('(prefers-color-scheme: dark)');
      const watchLight = window.matchMedia('(prefers-color-scheme: light)');
      const watchNone = window.matchMedia('(prefers-color-scheme: no-preference)');

      const interval = 30 * 60 * 1000;
      const nextHalfHour = interval - Math.round(new Date().getTime()) % interval;

      setTimeout(() => {
        dispatch('loadTheme');
      }, nextHalfHour);
      // console.log('Update theme in', nextHalfHour, 'ms');

      if ( watchDark.matches ) {
        changed('dark');
      } else if ( watchLight.matches ) {
        changed('light');
      } else {
        changed(fromClock());
      }

      // eslint-disable-next-line deprecation/deprecation
      watchDark.addListener((e) => {
        if ( e.matches ) {
          changed('dark');
        }
      });

      // eslint-disable-next-line deprecation/deprecation
      watchLight.addListener((e) => {
        if ( e.matches ) {
          changed('light');
        }
      });

      // eslint-disable-next-line deprecation/deprecation
      watchNone.addListener((e) => {
        if ( e.matches ) {
          changed(fromClock());
        }
      });
    }

    function changed(value) {
      // console.log('Prefers Theme:', value);
      dispatch('set', { key: PREFERS_SCHEME, value });
    }

    function fromClock() {
      const hour = new Date().getHours();

      if ( hour < 7 || hour >= 18 ) {
        return 'dark';
      }

      return 'light';
    }
  },

  async loadServer({ state, dispatch, commit }, ignoreKey) {
    let server = { data: {} };

    try {
      const all = await dispatch('management/findAll', {
        type: STEVE.PREFERENCE,
        opt:  {
          url:                  'userpreferences',
          force:                true,
          watch:                false,
          redirectUnauthorized: false,
        },
      }, { root: true });

      server = all?.[0];
    } catch (e) {
      console.error('Error loading preferences', e);
    }

    if ( !server?.data ) {
      return;
    }

    for (const key in definitions) {
      const definition = definitions[key];
      let value = clone(server.data[key]);

      if ( value === undefined || key === ignoreKey) {
        continue;
      }

      if ( definition.parseJSON ) {
        try {
          value = JSON.parse(value);
        } catch (err) {
          console.error('Error parsing server pref', key, value, err);
          continue;
        }
      }

      if ( definition.mangleRead ) {
        value = definition.mangleRead(value);
      }

      commit('load', { key, value });
    }

    return server;
  },

  setLastVisited({ state, dispatch }, route) {
    if (!route) {
      return;
    }

    const toSave = getLoginRoute(route);

    return dispatch('set', { key: LAST_VISITED, value: toSave });
  },

  toggleTheme({ getters, dispatch }) {
    const value = getters[THEME] === 'light' ? 'dark' : 'light';

    return dispatch('set', { key: THEME, value });
  },

  setBrandStyle({ rootState, rootGetters }, dark = false) {
    if (rootState.managementReady) {
      try {
        const brandSetting = rootGetters['management/byId'](MANAGEMENT.SETTING, SETTING.BRAND);

        if (brandSetting && brandSetting.value && brandSetting.value !== '') {
          const brand = brandSetting.value;

          const brandMeta = require(`~/assets/brand/${ brand }/metadata.json`);
          const hasStylesheet = brandMeta.hasStylesheet === 'true';

          if (hasStylesheet) {
            document.body.classList.add(brand);
          } else {
            // TODO option apply color at runtime
          }
        }
      } catch {}
    }
  },
};

function getLoginRoute(route) {
  let parts = route.name?.split('-') || [];
  const params = {};
  const routeParams = route.params || {};

  // Find the 'resource' part of the route, if it is there
  const index = parts.findIndex(p => p === 'resource');

  if (index >= 0) {
    parts = parts.slice(0, index);
  }

  // Just keep the params that are needed
  parts.forEach((param) => {
    if (routeParams[param]) {
      params[param] = routeParams[param];
    }
  });

  return {
    name: parts.join('-'),
    params,
  };
}
