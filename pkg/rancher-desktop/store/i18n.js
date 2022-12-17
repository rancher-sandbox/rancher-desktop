// eslint-disable-next-line import/no-named-as-default
import IntlMessageFormat from 'intl-messageformat';

import en from '@pkg/assets/translations/en-us.yaml';
import { LOCALE } from '@pkg/config/cookies';
import { getProduct, getVendor } from '@pkg/config/private-label';
import { get } from '@pkg/utils/object';

const translationContext = require.context('@pkg/assets/translations', true, /.*/);

const NONE = 'none';

// Formatters can't be serialized into state
const intlCache = {};

export const state = function() {
  const available = translationContext.keys().map(path => path.replace(/^.*\/([^\/]+)\.[^.]+$/, '$1'));

  const out = {
    default:      'en-us',
    selected:     null,
    previous:     null,
    available,
    translations: { 'en-us': en },
  };

  return out;
};

export const getters = {
  selectedLocaleLabel(state) {
    const key = `locale.${ state.selected }`;

    if ( state.selected === NONE ) {
      return `%${ key }%`;
    } else {
      return get(state.translations[state.default], key);
    }
  },

  availableLocales(state, getters) {
    const out = {};

    for ( const locale of state.available ) {
      const key = `locale.${ locale }`;

      if ( state.selected === NONE ) {
        out[locale] = `%${ key }%`;
      } else {
        out[locale] = get(state.translations[state.default], key);
      }
    }

    return out;
  },

  t: state => (key, args) => {
    if (state.selected === NONE ) {
      return `%${ key }%`;
    }

    const cacheKey = `${ state.selected }/${ key }`;
    let formatter = intlCache[cacheKey];

    if ( !formatter ) {
      let msg = get(state.translations[state.selected], key);

      if ( !msg ) {
        msg = get(state.translations[state.default], key);
      }

      if ( !msg ) {
        return undefined;
      }

      if ( typeof msg === 'object' ) {
        console.error('Translation for', cacheKey, 'is an object');

        return undefined;
      }

      if ( msg?.includes('{')) {
        formatter = new IntlMessageFormat(msg, state.selected);
      } else {
        formatter = msg;
      }

      intlCache[cacheKey] = formatter;
    }

    if ( typeof formatter === 'string' ) {
      return formatter;
    } else if ( formatter && formatter.format ) {
      // Inject things like appName so they're always available in any translation
      const moreArgs = {
        vendor:  getVendor(),
        appName: getProduct(),
        ...args,
      };

      return formatter.format(moreArgs);
    } else {
      return '?';
    }
  },

  exists: state => (key) => {
    const cacheKey = `${ state.selected }/${ key }`;

    if ( intlCache[cacheKey] ) {
      return true;
    }

    let msg = get(state.translations[state.default], key);

    if ( !msg && state.selected && state.selected !== NONE ) {
      msg = get(state.translations[state.selected], key);
    }

    if ( msg !== undefined ) {
      return true;
    }

    return false;
  },

  current: state => () => {
    return state.selected;
  },

  default: state => () => {
    return state.default;
  },

  withFallback: (state, getters) => (key, args, fallback, fallbackIsKey = false) => {
    // Support withFallback(key,fallback) when no args
    if ( !fallback && typeof args === 'string' ) {
      fallback = args;
      args = {};
    }

    if ( getters.exists(key) ) {
      return getters.t(key, args);
    } else if ( fallbackIsKey ) {
      return getters.t(fallback, args);
    } else {
      return fallback;
    }
  },
};

export const mutations = {
  loadTranslations(state, { locale, translations }) {
    state.translations[locale] = translations;
  },

  setSelected(state, locale) {
    state.selected = locale;
  },
};

export const actions = {
  init({ state, commit, dispatch }) {
    let selected = this.$cookies.get(LOCALE, { parseJSON: false });

    if ( !selected ) {
      selected = state.default;
    }

    return dispatch('switchTo', selected);
  },

  async load({ commit }, locale) {
    const translations = await translationContext(`./${ locale }.yaml`);

    commit('loadTranslations', { locale, translations });

    return true;
  },

  async switchTo({ state, commit, dispatch }, locale) {
    if ( locale === NONE ) {
      commit('setSelected', locale);

      // Don't remember into cookie
      return;
    }

    if ( !state.translations[locale] ) {
      try {
        await dispatch('load', locale);
      } catch (e) {
        if ( locale !== 'en-us' ) {
          // Try to show something...

          commit('setSelected', 'en-us');

          return;
        }
      }
    }

    commit('setSelected', locale);
    this.$cookies.set(LOCALE, locale, {
      encode: x => x,
      maxAge: 86400 * 365,
      secure: true,
      path:   '/',
    });
  },

  toggleNone({ state, dispatch }) {
    if ( state.selected === NONE ) {
      return dispatch('switchTo', state.previous || state.default);
    } else {
      return dispatch('switchTo', NONE);
    }
  },
};
