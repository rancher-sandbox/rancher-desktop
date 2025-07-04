import { jest } from '@jest/globals';

import { ExtensionManagerImpl } from '../manager';

describe('ExtensionManagerImpl', () => {
  describe('findBestVersion', () => {
    let subject: ExtensionManagerImpl;

    beforeEach(() => {
      subject = new ExtensionManagerImpl({ getTags: jest.fn() } as any, false);
    });

    test.each<[string[], string | RegExp | undefined]>([
      // Highest semver
      [['0.0.1', '0.0.3', '0.0.2'], '0.0.3'],
      // Use latest
      [['foo', 'latest', 'bar', 'xyzzy'], 'latest'],
      // No tags available
      [[], undefined],
      // Prefer proper semver over random numbers embedded in strings
      [['foo', 'chore23', '0.0.1'], '0.0.1'],
      // ... including with "v" prefix
      [['foo', 'chore23', 'v0.0.1'], 'v0.0.1'],
      // ... or "v." prefix
      [['foo', 'chore23', 'v.0.0.1'], 'v.0.0.1'],
      // If no semver, grab anything with numbers
      [['foo1', 'foo3', 'foo2'], 'foo3'],
    ])('%s => %s', async(versions, expected) => {
      jest.spyOn(subject.client, 'getTags').mockImplementation(() => {
        return Promise.resolve(new Set(versions));
      });
      if (expected === undefined) {
        await expect(subject['findBestVersion']('')).rejects.toThrow();
      } else if (typeof expected === 'string') {
        await expect(subject['findBestVersion']('')).resolves.toEqual(expected);
      } else {
        await expect(subject['findBestVersion']('')).resolves.toMatch(expected);
      }
    });
  });
});
