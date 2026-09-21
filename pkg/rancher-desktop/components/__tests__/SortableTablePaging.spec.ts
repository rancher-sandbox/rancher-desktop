import { jest } from '@jest/globals';
import { mount } from '@vue/test-utils';

import { ROWS_PER_PAGE } from '@pkg/store/prefs';
import mockModules from '@pkg/utils/testUtils/mockModules';

const componentStub = { template: '<div />' };

mockModules({
  '@rancher/components': {
    Checkbox:         componentStub,
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

const PER_PAGE_OPTIONS = [10, 25, 50, 100];
const PAGE_SIZE_SELECTOR = '[data-testid="pagination-per-page"]';
const MAIN_ROW_SELECTOR = 'tr.main-row';
const ROWS_THAT_NEED_PAGING = 30;

function rows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id:   `row-${ index }`,
    name: `row-${ index }`,
  }));
}

function mountTable(rowCount: number, extraProps: Record<string, any> = {}) {
  const dispatch = jest.fn();
  const wrapper = mount(SortableTable as any, {
    props: {
      headers:      [{ name: 'name', label: 'Name', sort: ['name'] }],
      keyField:     'id',
      rows:         rows(rowCount),
      paging:       true,
      rowActions:   false,
      tableActions: false,
      search:       false,
      ...extraProps,
    },
    global: {
      mocks: {
        $store: {
          getters: {
            'i18n/t':                                    () => (key: string) => key,
            'i18n/exists':                               () => () => false,
            'prefs/get':                                 () => PER_PAGE_OPTIONS[0],
            'prefs/options':                             () => PER_PAGE_OPTIONS,
            'resource-fetch/isTooManyItemsToAutoUpdate': false,
            'resource-fetch/manualRefreshIsLoading':     false,
            activeNamespaceCache:                        {},
          },
          commit: jest.fn(),
          dispatch,
        },
      },
      directives: {
        tooltip: {}, trimWhitespace: {}, shortkey: {}, cleanHtml: {}, cleanTooltip: {}, closePopper: {},
      },
      stubs: { t: componentStub },
    },
  });

  return { wrapper, dispatch };
}

function pageSizeSelector(wrapper: any) {
  return wrapper.find(PAGE_SIZE_SELECTOR);
}

function pageSizeOptions(wrapper: any) {
  return wrapper.findAll(`${ PAGE_SIZE_SELECTOR } option`);
}

function shownRows(wrapper: any) {
  return wrapper.findAll(MAIN_ROW_SELECTOR);
}

function goToPage(wrapper: any, page: number) {
  wrapper.vm.setPage(page);
}

function currentPage(wrapper: any) {
  return wrapper.vm.page;
}

describe('SortableTable page size', () => {
  it('offers every page size the preference defines', () => {
    const { wrapper } = mountTable(ROWS_THAT_NEED_PAGING);
    const offered = pageSizeOptions(wrapper).map((option: any) => option.attributes('value'));

    expect(offered).toEqual(PER_PAGE_OPTIONS.map(String));
  });

  it('stays out of the way when the page holds every row', () => {
    const { wrapper } = mountTable(PER_PAGE_OPTIONS[0]);

    expect(pageSizeSelector(wrapper).exists()).toBe(false);
  });

  it('stays out of the way when the caller fixes the page size', () => {
    const { wrapper } = mountTable(ROWS_THAT_NEED_PAGING, { rowsPerPage: PER_PAGE_OPTIONS[0] });

    expect(pageSizeSelector(wrapper).exists()).toBe(false);
  });

  it('shows the rows the chosen page size allows', async() => {
    const { wrapper } = mountTable(ROWS_THAT_NEED_PAGING);

    await pageSizeSelector(wrapper).setValue(String(PER_PAGE_OPTIONS[1]));

    expect(shownRows(wrapper)).toHaveLength(PER_PAGE_OPTIONS[1]);
  });

  it('returns to the first page when the page size changes', async() => {
    const { wrapper } = mountTable(ROWS_THAT_NEED_PAGING);

    goToPage(wrapper, 3);
    await pageSizeSelector(wrapper).setValue(String(PER_PAGE_OPTIONS[1]));

    expect(currentPage(wrapper)).toBe(1);
  });

  it('remembers the chosen page size', async() => {
    const { wrapper, dispatch } = mountTable(ROWS_THAT_NEED_PAGING);

    await pageSizeSelector(wrapper).setValue(String(PER_PAGE_OPTIONS[1]));

    expect(dispatch).toHaveBeenCalledWith('prefs/set', { key: ROWS_PER_PAGE, value: PER_PAGE_OPTIONS[1] });
  });

  it('keeps the page size selector reachable once a single page holds everything', async() => {
    const { wrapper } = mountTable(ROWS_THAT_NEED_PAGING);

    await pageSizeSelector(wrapper).setValue(String(PER_PAGE_OPTIONS.at(-1)));

    expect(pageSizeSelector(wrapper).exists()).toBe(true);
  });
});
