import fs from 'fs';
import path from 'path';

import { jest } from '@jest/globals';
import { shallowMount } from '@vue/test-utils';
import { createStore } from 'vuex';
import yaml from 'yaml';

import mockModules from '@pkg/utils/testUtils/mockModules';

const componentStub = { template: '<div />' };

mockModules({
  '@pkg/utils/ipcRenderer': {
    ipcRenderer: {
      on:   jest.fn(),
      once: jest.fn(),
      send: jest.fn(),
    },
  },
  '@rancher/components': {
    ToggleSwitch:     componentStub,
    Checkbox:         componentStub,
    LabeledTooltip:   componentStub,
    Banner:           componentStub,
    BadgeState:       componentStub,
    StringList:       componentStub,
    TextAreaAutoGrow: componentStub,
  },
  electron: undefined,
});

const i18n = await import('@pkg/store/i18n');
const { default: DiagnosticsBody } = await import('@pkg/components/DiagnosticsBody.vue');

const enUS = yaml.parse(fs.readFileSync(
  path.join(process.cwd(), 'pkg', 'rancher-desktop', 'assets', 'translations', 'en-us.yaml'),
  'utf8'));
const state = {
  default:      'en-us',
  selected:     'en-us',
  available:    ['en-us'],
  translations: { 'en-us': enUS },
};
const t = (i18n.getters as any).t(state);

function summary(mutedFlags: boolean[]) {
  const rows = mutedFlags.map((mute, i) => ({ id: `check-${ i }`, mute }));
  const wrapper = shallowMount(DiagnosticsBody, {
    props:  { rows: rows as any },
    global: {
      plugins: [createStore({
        modules: { preferences: { namespaced: true, getters: { showMuted: () => false } } },
      })],
      mocks: { t },
      stubs: { 'sortable-table': true },
    },
  });

  return wrapper.find('.item-results').text();
}

describe('DiagnosticsBody.vue failed count', () => {
  it('omits the muted count when nothing is muted', () => {
    expect(summary([false, false, false])).toBe('3 failed');
    expect(summary([])).toBe('0 failed');
  });

  it('shows the muted count when something is muted', () => {
    expect(summary([false, true, true])).toBe('1 failed plus 2 muted');
    expect(summary([true])).toBe('0 failed plus 1 muted');
  });
});
