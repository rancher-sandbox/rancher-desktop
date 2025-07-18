/** @jest-environment node */

import mockModules from '@pkg/utils/testUtils/mockModules';

const modules = mockModules({ electron: undefined });
const { default: dockerRegistry } = await import('@pkg/backend/containerClient/registry');

describe('DockerRegistry', () => {
  beforeEach(() => {
    // We need to send actual network requests in this test.
    modules.electron.net.fetch.mockImplementation(fetch);
  });
  describe('getTags', () => {
    it.skip('should get tags from unauthenticated registry', async() => {
      // Sometimes this URL is broken, returning 504 Gateway Time-out
      // It shouldn't be used for a unit test anyway.
      const reference = 'registry.opensuse.org/opensuse/leap';

      await expect(dockerRegistry.getTags(reference))
        .resolves
        .toEqual(expect.arrayContaining(['15.4']));
    });

    it('should get tags from docker hub', async() => {
      await expect(dockerRegistry.getTags('hello-world'))
        .resolves
        .toEqual(expect.arrayContaining(['linux']));
    });

    it('should fail trying to get tags from invalid registry', async() => {
      await expect(dockerRegistry.getTags('host.invalid/name'))
        .rejects
        .toThrow();
    });
  });
});
