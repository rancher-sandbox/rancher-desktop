import { IntlMessageFormat } from 'intl-messageformat';

import packageJson from '../../../package.json' with { type: 'json' };

import { LOCALE } from '@pkg/config/cookies';
import { getVendor } from '@pkg/config/private-label';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';
import { get } from '@pkg/utils/object';
import { availableLocales, loadTranslations } from '@pkg/utils/translationLoader';

// Formatters can't be serialized into state
const intlCache = {};
let ipcListenersBound = false;

export const state = function() {
  const out = {
    default:      'en-us',
    selected:     null,
    available:    [...availableLocales],
    translations: { 'en-us': loadTranslations('en-us') },
  };

  return out;
};

export const getters = {
  availableLocales(state) {
    const out = {};

    for ( const locale of state.available ) {
      const nativeName = get(state.translations[locale], `locale.${ locale }`);
      const translatedName = get(state.translations[state.selected], `locale.${ locale }`) ??
                          get(state.translations[state.default], `locale.${ locale }`);

      if ( !nativeName || !translatedName || nativeName === translatedName ) {
        out[locale] = nativeName ?? translatedName ?? locale;
      } else {
        out[locale] = `${ nativeName } (${ translatedName })`;
      }
    }

    return out;
  },

  t: state => (key, args) => {
    const cacheKey = `${ state.selected }/${ key }`;
    let formatter = intlCache[cacheKey];

    if ( !formatter ) {
      let msg = get(state.translations[state.selected], key);

      if ( !msg ) {
        msg = get(state.translations[state.default], key);
      }

      if ( !msg ) {
        // Visible placeholder, matching the main process; missing keys
        // must be debuggable, not silently blank.
        return `%${ key }%`;
      }

      if ( typeof msg === 'object' ) {
        console.error('Translation for', cacheKey, 'is an object');

        return `%${ key }%`;
      }

      if ( msg?.includes('{')) {
        try {
          // Uses the selected locale for formatting even when falling back to
          // English text. Acceptable: plural rules rarely diverge for the
          // strings used here.
          formatter = new IntlMessageFormat(msg, state.selected);
        } catch (e) {
          console.error(`Malformed ICU pattern for key "${ key }":`, e);
          formatter = msg;
        }
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
        appName: packageJson.productName,
        ...args,
      };

      try {
        return formatter.format(moreArgs);
      } catch (e) {
        // A missing argument must not abort the component render;
        // degrade to the raw pattern like the main-process interpolator.
        console.error(`Cannot format translation for key "${ key }":`, e);

        return get(state.translations[state.selected], key) ?? get(state.translations[state.default], key);
      }
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

    if ( !msg && state.selected ) {
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
  async init({ state, commit, dispatch }) {
    // Load all translation files so availableLocales can show native names.
    // Acceptable overhead with a small number of locales; revisit if locale
    // count grows significantly.
    await Promise.allSettled(
      state.available
        .filter(locale => !state.translations[locale])
        .map(locale => dispatch('load', locale)),
    );

    // The main process passes the resolved locale as a URL param, so the first
    // paint is already localized; the cookie is a fallback for a window opened
    // without one. Later changes arrive via settings-update below.
    const urlLocale = new URLSearchParams(window.location.search).get('locale');
    let selected = urlLocale || this.$cookies.get(LOCALE, { parseJSON: false });

    if ( !selected ) {
      selected = state.default;
    }

    if (!ipcListenersBound) {
      ipcListenersBound = true;

      // Listen for settings changes (from preferences UI or rdctl) to sync locale.
      ipcRenderer.on('settings-update', (_, settings) => {
        const locale = settings?.application?.locale || state.default;

        if ( locale !== state.selected ) {
          dispatch('switchTo', locale);
        }
      });
    }

    return dispatch('switchTo', selected);
  },

  async load({ commit }, locale) {
    const translations = loadTranslations(locale);

    commit('loadTranslations', { locale, translations });

    return true;
  },

  async switchTo({ state, commit, dispatch }, locale) {
    if ( !locale ) {
      locale = state.default;
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

    for (const key of Object.keys(intlCache)) {
      delete intlCache[key];
    }

    commit('setSelected', locale);
    this.$cookies.set(LOCALE, locale, {
      encode: x => x,
      maxAge: 86400 * 365,
      secure: true,
      path:   '/',
    });
  },

};
