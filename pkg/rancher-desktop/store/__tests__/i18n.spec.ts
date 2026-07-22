import { jest } from '@jest/globals';

import mockModules from '@pkg/utils/testUtils/mockModules';

mockModules({
  '@pkg/utils/ipcRenderer': {
    ipcRenderer: {
      on:   jest.fn(),
      once: jest.fn(),
      send: jest.fn(),
    },
  },
});

const i18n = await import('@pkg/store/i18n');

// Builds a minimal state shape for exercising the getters directly.
function makeState(translations: Record<string, unknown>, selected = 'de') {
  return {
    default:   'en-us',
    selected,
    available: Object.keys(translations),
    translations,
  };
}

const en = {
  simple:  'Plain text',
  nested:  { child: 'Nested value' },
  greet:   'Hello {name}',
  plural:  '{count, plural, one {# item} other {# items}}',
  invalid: 'Unbalanced {brace',
  special: 'Command & "Args"',
  product: 'Made by {appName}',
};
const de = {
  simple: 'Einfacher Text',
  greet:  'Hallo {name}',
};

describe('i18n store getters', () => {
  let state: ReturnType<typeof makeState>;

  beforeEach(() => {
    state = makeState({ 'en-us': en, de });
  });

  const t = (key: string, args?: Record<string, unknown>) => (i18n.getters as any).t(state)(key, args);

  it('returns the selected locale translation', () => {
    expect(t('simple')).toEqual('Einfacher Text');
  });

  it('falls back to en-us per key', () => {
    expect(t('nested.child')).toEqual('Nested value');
  });

  it('returns a visible %key% placeholder for a missing key', () => {
    expect(t('no.such.key')).toEqual('%no.such.key%');
  });

  it('formats ICU plurals', () => {
    expect(t('plural', { count: 1 })).toEqual('1 item');
    expect(t('plural', { count: 3 })).toEqual('3 items');
  });

  it('interpolates arguments', () => {
    expect(t('greet', { name: 'Jan' })).toEqual('Hallo Jan');
  });

  it('injects the product name for {appName}', () => {
    expect(t('product')).toEqual('Made by Rancher Desktop');
  });

  it('degrades to the raw pattern when an argument is missing', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(t('plural', {})).toEqual(en.plural);
    spy.mockRestore();
  });

  it('degrades to the raw text for malformed ICU patterns', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(t('invalid')).toEqual('Unbalanced {brace');
    spy.mockRestore();
  });

  it("does not HTML-escape; escaping is the sink's responsibility", () => {
    expect(t('special')).toEqual('Command & "Args"');
  });

  it('reports key existence', () => {
    const exists = (key: string) => (i18n.getters as any).exists(state)(key);

    expect(exists('simple')).toBe(true);
    expect(exists('no.such.key')).toBe(false);
  });
});

describe('availableLocales getter', () => {
  const availableLocales = (state: unknown) => (i18n.getters as any).availableLocales(state);

  // Codes whose alphabetical order differs from their labels', as in the real
  // locale set: by code ja < ko < pt-br, by label Português < 한국어 < 日本語.
  function scriptState(selected: string | null) {
    return {
      default:      'en-us',
      selected,
      available:    ['ja', 'ko', 'pt-br'],
      translations: {
        'en-us': {
          locale: {
            ja: 'Japanese', ko: 'Korean', 'pt-br': 'Portuguese (Brazilian)',
          },
        },
        ja:      { locale: { ja: '日本語' } },
        ko:      { locale: { ko: '한국어' } },
        'pt-br': { locale: { 'pt-br': 'Português (Brasil)' } },
      },
    };
  }

  // German collates Ä with A, Swedish sorts it after Z.
  function collationState(selected: string) {
    return {
      default:      'en-us',
      selected,
      available:    ['de', 'sv'],
      translations: {
        'en-us': { locale: { de: 'Zebra', sv: 'Äpfel' } },
        de:      { locale: { de: 'Zebra' } },
        sv:      { locale: { sv: 'Äpfel' } },
      },
    };
  }

  it('orders locales by label rather than by locale code', () => {
    expect(Object.keys(availableLocales(scriptState('en-us')))).toEqual(['pt-br', 'ko', 'ja']);
  });

  it('collates in the selected locale', () => {
    expect(Object.keys(availableLocales(collationState('de')))).toEqual(['sv', 'de']);
    expect(Object.keys(availableLocales(collationState('sv')))).toEqual(['de', 'sv']);
  });

  it('collates with the default locale before a selection is made', () => {
    expect(Object.keys(availableLocales(scriptState(null)))).toEqual(['pt-br', 'ko', 'ja']);
  });

  it('collates with the default locale when the selection is not a bundled locale', () => {
    expect(Object.keys(availableLocales(scriptState('none')))).toEqual(['pt-br', 'ko', 'ja']);
  });
});
