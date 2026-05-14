import { jest } from '@jest/globals';

import mockModules from '@pkg/utils/testUtils/mockModules';

const componentStub = { template: '<div />' };

mockModules({
  '@pkg/components/EmptyState.vue':             componentStub,
  '@pkg/components/LoadingIndicator.vue':       componentStub,
  '@pkg/components/NavIconExtension.vue':       componentStub,
  '@pkg/components/SortableTable/index.vue':    componentStub,
  '@pkg/hocs/withCredentials':                  { default: jest.fn() },
  '@pkg/utils/ipcRenderer':                    {
    ipcRenderer: {
      on: jest.fn(),
    },
  },
});

const { default: InstalledExtensions } = await import('@pkg/pages/extensions/installed.vue');
const methods = (InstalledExtensions as any).methods;

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
