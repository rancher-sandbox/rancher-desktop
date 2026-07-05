import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';

import i18nPlugin, { stringFor } from '@pkg/plugins/i18n';

const translations: Record<string, string> = {
  'test.plain':   'Plain text',
  'test.special': 'Command & "Args"',
  'test.entity':  'Loading&hellip;',
  'test.html':    'See <a href="https://example.com/">docs</a>',
};

function makeStore() {
  return createStore({
    modules: {
      i18n: {
        namespaced: true,
        getters:    {
          t:      () => (key: string) => translations[key] ?? `%${ key }%`,
          exists: () => (key: string) => key in translations,
        },
      },
    },
  });
}

describe('stringFor', () => {
  it('returns the translation without HTML-escaping', () => {
    expect(stringFor(makeStore(), 'test.special')).toEqual('Command & "Args"');
  });

  it('passes the %key% placeholder through for missing keys', () => {
    expect(stringFor(makeStore(), 'no.such.key')).toEqual('%no.such.key%');
  });
});

describe('t component', () => {
  function mountT(template: string) {
    const store = makeStore();

    return mount({ template }, { global: { plugins: [store, i18nPlugin] } });
  }

  it('renders text children unescaped; the text sink escapes', () => {
    const wrapper = mountT('<t k="test.special" />');

    expect(wrapper.text()).toEqual('Command & "Args"');
  });

  it('renders HTML entities when raw', () => {
    const wrapper = mountT('<t k="test.entity" raw />');

    expect(wrapper.element.textContent).toEqual('Loading…');
  });

  it('renders markup when raw', () => {
    const wrapper = mountT('<t k="test.html" raw />');

    expect(wrapper.find('a').attributes('href')).toEqual('https://example.com/');
  });
});

describe('v-t directive', () => {
  function mountDirective(template: string) {
    const store = makeStore();

    return mount({ template }, { global: { plugins: [store, i18nPlugin] } });
  }

  it('renders the raw translation as innerHTML', () => {
    const wrapper = mountDirective(`<span v-t="'test.entity'" />`);

    expect(wrapper.element.textContent).toEqual('Loading…');
  });

  it('sets attributes to the raw translation', () => {
    const wrapper = mountDirective(`<span v-t:title="'test.special'" />`);

    expect(wrapper.attributes('title')).toEqual('Command & "Args"');
  });
});
