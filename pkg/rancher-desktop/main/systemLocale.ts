import Electron from 'electron';

import { defaultSettings, Locale, localeFromLanguageTag } from '@pkg/config/settings';

/**
 * The bundled locale matching the user's preferred system language, or en-us
 * when no preferred language is supported.
 *
 * This is only used when creating a new settings file, so existing users keep
 * the language they selected.
 */
export function getSystemLocale(): Locale {
  try {
    const languageTags = [
      ...Electron.app.getPreferredSystemLanguages(),
      Electron.app.getSystemLocale(),
      Electron.app.getLocale(),
    ];

    for (const languageTag of languageTags) {
      const locale = localeFromLanguageTag(languageTag);

      if (locale) {
        return locale;
      }
    }
  } catch (err) {
    console.warn('Failed to determine the system locale:', err);
  }

  return defaultSettings.application.locale;
}
