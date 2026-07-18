/**
 * Shared translation helper for tests and mocks.
 *
 * Loads the English YAML once and provides a t() function using the same
 * ICU MessageFormat engine as the renderer and the main process.
 */

import { IntlMessageFormat } from 'intl-messageformat';

import { availableLocales, loadTranslations } from '../translationLoader';

type TranslationMap = Record<string, unknown>;

const en = loadTranslations('en-us') as TranslationMap;

export { availableLocales };

function getByPath(obj: TranslationMap, keyPath: string): string | undefined {
  let current: unknown = obj;

  for (const segment of keyPath.split('.')) {
    if (current == null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return typeof current === 'string' ? current : undefined;
}

export function t(key: string, args?: Record<string, string | number>): string {
  const msg = getByPath(en, key);

  if (msg === undefined) {
    return `%${ key }%`;
  }

  try {
    return new IntlMessageFormat(msg, 'en-us').format(args) as string;
  } catch {
    return msg;
  }
}
