import { jest } from '@jest/globals';
import { mount } from '@vue/test-utils';

import mockModules from '@pkg/utils/testUtils/mockModules';

const componentStub = { template: '<div />' };

mockModules({
  '@rancher/components': {
    Checkbox:         { template: '<div class="checkbox-container" />' },
    LabeledTooltip:   componentStub,
    Banner:           componentStub,
    BadgeState:       componentStub,
    StringList:       componentStub,
    TextAreaAutoGrow: componentStub,
  },
});

function stubResizeObserverMissingFromJsdom() {
  global.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

stubResizeObserverMissingFromJsdom();

const { default: SortableTable } = await import('@pkg/components/SortableTable/index.vue');

interface Row {
  id:               string;
  containerName:    string;
  projectGroup:     string;
  availableActions: { label: string, action: string, enabled: boolean, bulkable: boolean }[];
}

function row(id: string, projectGroup = 'one'): Row {
  return {
    id,
    containerName:    id,
    projectGroup,
    availableActions: [{
      label: 'Stop', action: 'stopContainer', enabled: true, bulkable: true,
    }],
  };
}

const storeGetters: Record<string, any> = {
  'i18n/t':                                    () => (key: string) => key,
  'i18n/exists':                               () => () => false,
  'prefs/get':                                 () => 10,
  'resource-fetch/isTooManyItemsToAutoUpdate': false,
  'resource-fetch/manualRefreshIsLoading':     false,
  activeNamespaceCache:                        {},
};

const store = {
  getters:  storeGetters,
  commit:   jest.fn(),
  dispatch: jest.fn(),
};

function mountTable(rows: Row[], extraProps: Record<string, any> = {}) {
  return mount(SortableTable as any, {
    props: {
      headers:      [{ name: 'containerName', label: 'Name', sort: ['containerName'] }],
      keyField:     'id',
      rows,
      rowActions:   false,
      tableActions: true,
      search:       false,
      ...extraProps,
    },
    slots:  {
      'col:containerName': '<td><a class="container-name-link">{{ params.row.containerName }}</a></td>',
    },
    global: {
      mocks:      { $store: store },
      directives: {
        tooltip:        {},
        trimWhitespace: {},
        shortkey:       {},
        cleanHtml:      {},
        cleanTooltip:   {},
        closePopper:    {},
      },
      stubs: { t: componentStub },
    },
  });
}

const EXTENDS_SELECTION = { shiftKey: true };
const ADDS_TO_SELECTION = { ctrlKey: true, metaKey: true };

function click(wrapper: any, rowIndex: number, cellSelector: string, modifiers: Record<string, boolean> = {}) {
  const cell = wrapper.findAll('tr.main-row')[rowIndex].find(cellSelector).element;

  cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, ...modifiers }));
  cell.dispatchEvent(new MouseEvent('click', { bubbles: true, ...modifiers }));

  return wrapper.vm.$nextTick();
}

function clickCell(wrapper: any, rowIndex: number, modifiers: Record<string, boolean> = {}) {
  return click(wrapper, rowIndex, 'td:not(.row-check)', modifiers);
}

function clickContainerNameLink(wrapper: any, rowIndex: number, modifiers: Record<string, boolean> = {}) {
  return click(wrapper, rowIndex, '.container-name-link', modifiers);
}

function selectedRowsOf(wrapper: any) {
  return wrapper.vm.selectedRows;
}

function threeRows() {
  return [row('a'), row('b'), row('c')];
}

describe('SortableTable selection', () => {
  it('extends the selection to the shift-clicked row', async() => {
    const rows = threeRows();
    const wrapper = mountTable(rows);

    await clickCell(wrapper, 0);
    await clickCell(wrapper, 2, EXTENDS_SELECTION);

    expect(selectedRowsOf(wrapper)).toEqual(rows);
  });

  it('extends the selection when the shift-click lands on a link', async() => {
    const rows = threeRows();
    const wrapper = mountTable(rows);

    await clickContainerNameLink(wrapper, 0, EXTENDS_SELECTION);
    await clickContainerNameLink(wrapper, 2, EXTENDS_SELECTION);

    expect(selectedRowsOf(wrapper)).toEqual(rows);
  });

  it('extends the selection across groups', async() => {
    const rows = [row('a', 'one'), row('b', 'two'), row('c', 'two')];
    const wrapper = mountTable(rows, { groupBy: 'projectGroup' });

    await clickCell(wrapper, 0);
    await clickCell(wrapper, 2, EXTENDS_SELECTION);

    expect(selectedRowsOf(wrapper)).toEqual(rows);
  });

  it('deselects only the row that was clicked', async() => {
    const rows = threeRows();
    const wrapper = mountTable(rows);

    await clickCell(wrapper, 0);
    await clickCell(wrapper, 2, EXTENDS_SELECTION);
    await clickCell(wrapper, 1, ADDS_TO_SELECTION);

    expect(selectedRowsOf(wrapper)).toEqual([rows[0], rows[2]]);
  });

  it('keeps the selection when the rows are rebuilt', async() => {
    const rows = threeRows();
    const wrapper = mountTable(rows);

    await clickCell(wrapper, 0);
    await clickCell(wrapper, 1, EXTENDS_SELECTION);

    const rebuiltRows = threeRows();

    await wrapper.setProps({ rows: rebuiltRows });

    expect(selectedRowsOf(wrapper)).toEqual([rebuiltRows[0], rebuiltRows[1]]);
  });

  it('extends the selection from an anchor row that was rebuilt', async() => {
    const rows = threeRows();
    const wrapper = mountTable(rows);

    await clickCell(wrapper, 0);

    const rebuiltRows = threeRows();

    await wrapper.setProps({ rows: rebuiltRows });
    await clickCell(wrapper, 2, EXTENDS_SELECTION);

    expect(selectedRowsOf(wrapper)).toEqual(rebuiltRows);
  });
});
