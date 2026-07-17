/**
 * i18n for the main process: the same YAML translation files and ICU
 * MessageFormat engine as the renderer, without the Vuex store.
 */

import { IntlMessageFormat } from 'intl-messageformat';
import get from 'lodash/get.js';

import mainEvents from '@pkg/main/mainEvents';
import { availableLocales, loadTranslations } from '@pkg/utils/translationLoader';

export { availableLocales } from '@pkg/utils/translationLoader';

type TranslationMap = Record<string, unknown>;

let currentLocale = 'en-us';
const translations: Record<string, TranslationMap> = { 'en-us': loadTranslations('en-us') };
const localeChangeCallbacks: (() => void)[] = [];

/**
 * Look up a dotted key path, returning the value only when it is a string;
 * a key that resolves to a subtree counts as missing.
 */
function getByPath(obj: TranslationMap, path: string): string | undefined {
  const value = get(obj, path);

  return typeof value === 'string' ? value : undefined;
}

/**
 * Load a locale's translations if not already loaded.
 */
function loadLocale(locale: string): boolean {
  if (translations[locale]) {
    return true;
  }
  try {
    translations[locale] = loadTranslations(locale);

    return true;
  } catch {
    console.error(`i18n: failed to load locale "${ locale }"`);

    return false;
  }
}

// Formatter instances are cached per locale and key; the locale prefix
// makes entries from a previous locale unreachable after a switch.
const intlCache: Record<string, IntlMessageFormat | string> = {};

/**
 * Translate a key with ICU MessageFormat interpolation.
 * Falls back to en-us if the key is missing in the current locale, and
 * to a visible %key% placeholder if it is missing entirely.
 */
export function t(key: string, args?: Record<string, string | number>): string {
  const cacheKey = `${ currentLocale }/${ key }`;
  let formatter = intlCache[cacheKey];

  if (formatter === undefined) {
    const msg = getByPath(translations[currentLocale], key) ??
           getByPath(translations['en-us'], key);

    if (msg === undefined) {
      return `%${ key }%`;
    }

    if (msg.includes('{') || msg.includes("'")) {
      try {
        formatter = new IntlMessageFormat(msg, currentLocale);
      } catch (e) {
        console.error(`Malformed ICU pattern for key "${ key }":`, e);
        formatter = msg;
      }
    } else {
      formatter = msg;
    }
    intlCache[cacheKey] = formatter;
  }

  if (typeof formatter === 'string') {
    return formatter;
  }
  // Numbers stay numbers for plural rules; everything else formats as a
  // string, so a non-primitive value cannot make ICU emit an array of parts.
  const stringArgs = args && Object.fromEntries(Object.entries(args)
    .map(([name, value]) => [name, typeof value === 'number' ? value : String(value)]));

  try {
    return formatter.format(stringArgs) as string;
  } catch (e) {
    // A missing argument must not break the caller; degrade to the raw
    // pattern like the renderer does.
    console.error(`Cannot format translation for key "${ key }":`, e);

    return getByPath(translations[currentLocale], key) ??
        getByPath(translations['en-us'], key) ?? `%${ key }%`;
  }
}

/**
 * Register a callback to run after the locale has been loaded.
 * Use this instead of listening to settings-update directly, which
 * would race against the locale loading.
 * Returns a function that removes the callback.
 */
export function onLocaleChange(callback: () => void): () => void {
  localeChangeCallbacks.push(callback);

  return () => {
    const idx = localeChangeCallbacks.indexOf(callback);

    if (idx >= 0) {
      localeChangeCallbacks.splice(idx, 1);
    }
  };
}

/**
 * Initialize main-process i18n: read current locale from settings and
 * listen for changes.
 */
export async function initMainI18n(): Promise<void> {
  try {
    const settings = await mainEvents.invoke('settings-fetch');
    // 'none' means the language selector is disabled; use English.
    const raw = settings?.application?.locale;
    const locale = (!raw || raw === 'none') ? 'en-us' : raw;

    if (locale !== currentLocale && loadLocale(locale)) {
      currentLocale = locale;
    }
  } catch (err) {
    // settings-fetch handler may not be registered yet during early startup.
    console.debug('initMainI18n: could not read initial settings:', err);
  }

  mainEvents.on('settings-update', (settings) => {
    const raw = settings?.application?.locale;
    const locale = (!raw || raw === 'none') ? 'en-us' : raw;

    if (locale !== currentLocale) {
      if (!loadLocale(locale)) {
        return; // load failed, stay on current locale
      }
      currentLocale = locale;
      for (const callback of [...localeChangeCallbacks]) {
        try {
          callback();
        } catch (err) {
          console.error('Locale change callback failed:', err);
        }
      }
    }
  });
}
