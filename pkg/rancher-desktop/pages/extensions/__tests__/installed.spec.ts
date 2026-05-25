import { jest } from '@jest/globals';
import { shallowMount } from '@vue/test-utils';

import mockModules from '@pkg/utils/testUtils/mockModules';

const componentStub = { template: '<div />' };
const sortableTableStub = {
  name:  'SortableTable',
  props: {
    defaultSortBy: String,
    headers:       Array,
    rows:          Array,
    loading:       Boolean,
    search:        Boolean,
    tableActions:  Boolean,
    rowActions:    Boolean,
    keyField:      String,
  },
  template: '<table />',
};

mockModules({
  '@pkg/components/EmptyState.vue':             componentStub,
  '@pkg/components/LoadingIndicator.vue':       componentStub,
  '@pkg/components/NavIconExtension.vue':       componentStub,
  '@pkg/components/SortableTable/index.vue':    sortableTableStub,
  '@pkg/hocs/withCredentials':                  { default: jest.fn() },
  '@pkg/utils/ipcRenderer':                    {
    ipcRenderer: {
      on: jest.fn(),
    },
  },
});

const { default: InstalledExtensions } = await import('@pkg/pages/extensions/installed.vue');
const methods = (InstalledExtensions as any).methods;

describe('extensions installed table', () => {
  it('sorts installed extensions by displayed name by default', () => {
    const wrapper = shallowMount(InstalledExtensions, {
      computed: {
        ...(InstalledExtensions as any).computed,
        installedExtensions: () => [],
      },
      global: {
        mocks: {
          $store: {
            dispatch: jest.fn(),
          },
        },
      },
    });

    expect(wrapper.getComponent(sortableTableStub).props('defaultSortBy')).toBe('title');
  });
});

describe('extensions metadata', () => {
  it('builds installed extension metadata from OCI labels', () => {
    const extension = {
      id:     'publisher/sample-extension',
      labels: {
        'org.opencontainers.image.title':        'Sample Extension',
        'org.opencontainers.image.vendor':       'Example Publisher',
        'org.opencontainers.image.description':  'Adds sample tools.',
        'io.rancherdesktop.extension.more-info': 'https://docs.example.test/sample-extension',
      },
    };

    expect(methods.extensionTitle(extension)).toBe('Sample Extension');
    expect(methods.extensionVendor(extension)).toBe('Example Publisher');
    expect(methods.extensionDescription(extension)).toBe('Adds sample tools.');
    expect(methods.extensionLink(extension)).toBe('https://docs.example.test/sample-extension');
  });

  it('uses useful fallbacks for installed extensions without metadata labels', () => {
    const extension = {
      id:     'publisher/sample-extension',
      labels: {},
    };

    expect(methods.extensionTitle(extension)).toBe('publisher/sample-extension');
    expect(methods.extensionVendor(extension)).toBe('');
    expect(methods.extensionDescription(extension)).toBe('');
    expect(methods.extensionLink(extension)).toBe(
      'https://hub.docker.com/extensions/publisher/sample-extension',
    );
  });

  it('links non-Docker-Hub extension IDs as host names', () => {
    const extension = {
      id:     'extensions.example.test/sample-extension',
      labels: {},
    };

    expect(methods.extensionLink(extension)).toBe(
      'https://extensions.example.test/sample-extension',
    );
  });
});
