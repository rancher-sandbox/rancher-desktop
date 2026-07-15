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
