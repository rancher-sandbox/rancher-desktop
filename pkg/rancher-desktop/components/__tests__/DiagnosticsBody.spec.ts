import { jest } from '@jest/globals';
import { shallowMount } from '@vue/test-utils';
import { createStore } from 'vuex';

import mockModules from '@pkg/utils/testUtils/mockModules';
import { t } from '@pkg/utils/testUtils/translations';

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

const { default: DiagnosticsBody } = await import('@pkg/components/DiagnosticsBody.vue');

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
