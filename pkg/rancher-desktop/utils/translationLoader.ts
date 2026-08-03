/**
 * Access to the bundled translation YAML files, shared by the renderer
 * store and the main process. Under webpack the locale files are bundled
 * at build time; other runtimes (jest, tsx-run scripts) read the same
 * files from disk.
 */

/// <reference types="webpack/module" />

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import yaml from 'js-yaml';

interface TranslationSource {
  locales: string[];
  load(locale: string): Record<string, unknown>;
}

function webpackSource(): TranslationSource {
  // All locale YAML files are bundled at build time (default 'sync' mode;
  // nothing is loaded lazily).
  const context = import.meta.webpackContext(
    '@pkg/assets/translations', { recursive: false, regExp: /\.yaml$/ },
  );

  return {
    locales: context.keys().map(p => p.replace(/^.*\/([^\/]+)\.[^.]+$/, '$1')),
    load:    locale => context(`./${ locale }.yaml`) as Record<string, unknown>,
  };
}

function filesystemSource(): TranslationSource {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'translations');

  return {
    locales: fs.readdirSync(dir).filter(f => f.endsWith('.yaml')).map(f => f.replace(/\.yaml$/, '')),
    load:    locale => yaml.load(fs.readFileSync(path.join(dir, `${ locale }.yaml`), 'utf8')) as Record<string, unknown>,
  };
}

const source = import.meta.webpack ? webpackSource() : filesystemSource();

/** Locale codes derived from the bundled translation files. */
export const availableLocales: string[] = source.locales;

/** Returns the parsed translations for a bundled locale. */
export function loadTranslations(locale: string): Record<string, unknown> {
  return source.load(locale);
}
