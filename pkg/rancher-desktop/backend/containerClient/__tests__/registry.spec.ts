/** @jest-environment node */

import { FetchError } from 'node-fetch';

import dockerRegistry, { getAsList } from '@pkg/backend/containerClient/registry';
import { Headers } from '@pkg/utils/fetch';

describe('Headers', () => {
  test('getAsList', () => {
    const headers = new Headers();

    headers.append('a', '1');
    headers.append('A', '2');
    headers.append('b', '3');

    expect(headers.get('a')).toEqual('1, 2');
    expect(headers[getAsList]('a')).toEqual(['1', '2']);
    expect(headers[getAsList]('B')).toEqual(['3']);
    expect(headers[getAsList]('c')).toBeNull();
  });
});

describe('DockerRegistry', () => {
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
        .toThrow(FetchError);
    });
  });
});
