/** @jest-environment node */

import fs from 'fs';
import os from 'os';
import path from 'path';
import util from 'util';

import { jest } from '@jest/globals';
import fetch, { Response as FetchResponse } from 'node-fetch';
import * as nodeFetch from 'node-fetch';
import semver from 'semver';

import { SemanticVersionEntry } from '@pkg/utils/kubeVersions';
import paths from '@pkg/utils/paths';
import mockModules from '@pkg/utils/testUtils/mockModules';

import type { ReleaseAPIEntry } from '../k3sHelper';

const cachePath = path.join(paths.cache, 'k3s-versions.json');

const modules = mockModules({
  'node-fetch': {
    ...nodeFetch,
    default: jest.fn<(...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>>((...args) => {
      throw new Error('Unexpected network traffic');
    }),
  },
  '@pkg/utils/logging': undefined,
});

const { default: K3sHelper, buildVersion, ChannelMapping, NoCachedK3sVersionsError } = await import('../k3sHelper');

let cacheData: Buffer | null;

beforeAll(() => {
  try {
    cacheData = fs.readFileSync(cachePath);
  } catch (err) {
    cacheData = null;
  }
});
afterAll(() => {
  if (cacheData) {
    fs.writeFileSync(cachePath, cacheData);
  } else {
    fs.rmSync(cachePath);
  }
});

beforeEach(() => {
  modules['node-fetch'].default.mockReset();
});

describe(buildVersion, () => {
  test('parses the build number', () => {
    expect(buildVersion(new semver.SemVer('v1.99.3+k3s4'))).toEqual(4);
  });

  test('handles non-conforming versions', () => {
    expect(buildVersion(new semver.SemVer('v1.99.3'))).toEqual(-1);
  });
});

describe(K3sHelper, () => {
  describe('processVersion', () => {
    let subject: InstanceType<typeof K3sHelper>;
    const process = (name: string, existing: string[] = [], hasAssets = false) => {
      const assets: ReleaseAPIEntry['assets'] = [];

      if (hasAssets) {
        for (const name of Object.values(subject['filenames'])) {
          if (typeof name === 'string') {
            assets.push({ name, browser_download_url: name });
          } else {
            assets.push({ name: name[0], browser_download_url: name[0] });
          }
        }
      }

      for (const version of existing) {
        const parsed = new semver.SemVer(version);

        subject['versions'][parsed.version] = new SemanticVersionEntry(parsed);
      }

      return subject['processVersion']({ tag_name: name, assets });
    };

    beforeEach(() => {
      subject = new K3sHelper('x86_64');
      // Note that we _do not_ initialize this, i.e. we don't trigger an
      // initial fetch of the releases.  Instead, we pretend that is done.
      subject['pendingInitialize'] = Promise.resolve();
    });
    it('should skip invalid versions', async() => {
      expect(process('xxx')).toEqual(true);
      expect(await subject.availableVersions).toHaveLength(0);
    });
    it('should skip prereleases', async() => {
      expect(process('1.99.3-beta1')).toEqual(true);
      expect(await subject.availableVersions).toHaveLength(0);
    });
    it('should skip valid but erroneous versions', async() => {
      expect(process('1.99.3+rk3s1')).toEqual(true);
      expect(await subject.availableVersions).toHaveLength(0);
    });
    it('should ignore old versions', async() => {
      expect(process('1.2.0')).toEqual(true);
      expect(await subject.availableVersions).toHaveLength(0);
    });
    it('should ignore obsolete builds', async() => {
      expect(process('1.99.3+k3s4', ['1.99.3+k3s5'])).toEqual(true);
      expect(await subject.availableVersions).toHaveLength(1);
    });
    it('should ignore existing builds', async() => {
      expect(process('1.99.3+k3s4', ['1.99.3+k3s4'])).toEqual(false);
      expect(await subject.availableVersions).toHaveLength(1);
    });
    it('should ignore versions with missing assets', async() => {
      expect(process('1.99.3+k3s4')).toEqual(true);
      expect(await subject.availableVersions).toHaveLength(0);
    });
    it('should add versions', async() => {
      expect(process('1.99.3+k3s4', [], true)).toEqual(true);
      expect(await subject.availableVersions).toHaveLength(1);
    });
  });

  test('cache read/write', async() => {
    const subject = new K3sHelper('x86_64');
    const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rd-test-cache-'));
    const versions: Record<string, SemanticVersionEntry> = {
      '1.99.3': new SemanticVersionEntry(semver.parse('1.99.3+k3s1') as semver.SemVer, ['stable']),
      '2.3.4':  new SemanticVersionEntry(semver.parse('2.3.4+k3s3') as semver.SemVer),
    };
    const versionStrings = Object.values(versions)
      .map(v => v.version)
      .sort((a, b) => a.compare(b))
      .map(v => v.raw);

    try {
      // We need to cast to any in order to override readonly.
      (subject as any).cachePath = path.join(workDir, 'cache.json');
      subject['versions'] = versions;
      await subject['writeCache']();

      const actual = JSON.parse(await fs.promises.readFile(subject['cachePath'], 'utf8'));
      const { versions: actualStrings, channels }: {versions: string[], channels: {[k: string]: string}} = actual;

      expect(actual).toHaveProperty('cacheVersion');
      expect(semver.sort(actualStrings)).toEqual(versionStrings);
      expect(channels).toEqual({ stable: '1.99.3' });

      // Check that we can load the values back properly
      subject['versions'] = {};
      await subject['readCache']();
      expect(subject['versions']).toEqual(versions);
    } finally {
      await util.promisify(fs.rm)(workDir, { recursive: true, force: true });
    }
  });

  test('updateCache', async() => {
    const subject = new K3sHelper('x86_64');
    const validAssets = Object.values(subject['filenames']).map((name) => {
      if (typeof name === 'string') {
        return { name, browser_download_url: name };
      } else {
        return { name: name[0], browser_download_url: name[0] };
      }
    });

    // Override cache reading to return a fake existing cache.
    // The first read returns nothing to trigger a synchronous update;
    // the rest of the reads return mocked values.
    jest.spyOn(subject, 'readCache' as any)
      .mockResolvedValueOnce(undefined)
      .mockImplementation(function(this: InstanceType<typeof K3sHelper>) {
        const result = new ChannelMapping();

        for (const [version, tags] of Object.entries({
          'v1.99.1+k3s1': ['stale-tag'],
          'v1.99.3+k3s1': ['stable'],
        })) {
          const parsedVersion = new semver.SemVer(version);

          this.versions[parsedVersion.version] = new SemanticVersionEntry(parsedVersion, tags);
          for (const tag of tags) {
            result[tag] = parsedVersion;
          }
        }

        return Promise.resolve(result);
      });
    subject['writeCache'] = jest.fn(() => Promise.resolve());
    // On rate limiting, continue immediately.
    subject['delayForWaitLimiting'] = jest.fn(() => Promise.resolve());

    // Fake out the results
    modules['node-fetch'].default
      .mockImplementationOnce((url) => {
        expect(url).toEqual(subject['channelApiUrl']);

        return Promise.resolve(new FetchResponse(
          JSON.stringify({
            resourceType: 'channels',
            data:         [{
              type:   'channel',
              name:   'stable',
              latest: 'v1.99.3+k3s3',
            }],
          }),
        ));
      })
      .mockImplementationOnce((url) => {
        expect(url).toEqual(subject['releaseApiUrl']);

        return Promise.resolve(new FetchResponse(
          JSON.stringify([
            { tag_name: 'v1.99.3+k3s2', assets: validAssets },
            { tag_name: 'v1.99.3+k3s3', assets: validAssets },
            // The next one is skipped because there's a newer build
            { tag_name: 'v1.99.3+k3s1', assets: validAssets },
            { tag_name: 'v1.99.4+k3s1', assets: [] },
            { tag_name: 'v1.99.1+k3s2', assets: validAssets },
          ]),
          { headers: { link: '<url>; rel="next"' } },
        ));
      })
      .mockImplementationOnce((url) => {
        expect(url).toEqual('url');

        return Promise.resolve(new FetchResponse(
          undefined,
          { status: 403, headers: { 'X-RateLimit-Remaining': '0' } },
        ));
      })
      .mockImplementationOnce((url) => {
        expect(url).toEqual('url');

        return Promise.resolve(new FetchResponse(
          JSON.stringify([
            { tag_name: 'Invalid tag name', assets: validAssets },
            { tag_name: 'v1.99.0+k3s5', assets: validAssets },
          ]),
          { headers: { link: '<url>; rel="first"' } },
        ));
      })
      .mockImplementationOnce((url) => {
        throw new Error(`Unexpected fetch call to ${ url }`);
      });

    // Ensure the Latch is set up in K3sHelper
    subject.networkReady();

    await subject.initialize();
    expect(modules['node-fetch'].default).toHaveBeenCalledTimes(4);
    expect(subject['delayForWaitLimiting']).toHaveBeenCalledTimes(1);
    expect(await subject.availableVersions).toEqual([
      new SemanticVersionEntry(new semver.SemVer('v1.99.3+k3s3'), ['stable']),
      new SemanticVersionEntry(new semver.SemVer('v1.99.1+k3s2')),
      new SemanticVersionEntry(new semver.SemVer('v1.99.0+k3s5')),
    ]);
  });

  test('updateCache with new versions', async() => {
    const subject = new K3sHelper('x86_64');
    const validAssets = Object.values(subject['filenames']).map((name) => {
      if (typeof name === 'string') {
        return { name, browser_download_url: name };
      } else {
        return { name: name[0], browser_download_url: name[0] };
      }
    });

    // Override cache reading to return a fake existing cache.
    // The first read returns nothing to trigger a synchronous update;
    // the rest of the reads return mocked values.
    jest.spyOn(subject, 'readCache' as any)
      .mockResolvedValueOnce(undefined)
      .mockImplementation(function(this: InstanceType<typeof K3sHelper>) {
        const result = new ChannelMapping();

        for (const [version, tags] of Object.entries({
          'v1.96.0+k3s2': [],
          'v1.96.1+k3s1': [],
          'v1.96.2+k3s1': [],
          'v1.96.3+k3s1': ['v1.96', 'stable'],
          'v1.97.1+k3s1': [],
          'v1.97.2+k3s1': [],
          'v1.97.3+k3s1': [],
          'v1.97.4+k3s1': [],
          'v1.97.5+k3s1': ['v1.97', 'latest'],
        })) {
          const parsedVersion = new semver.SemVer(version);

          this.versions[parsedVersion.version] = new SemanticVersionEntry(parsedVersion, tags);
          for (const tag of tags) {
            result[tag] = parsedVersion;
          }
        }

        subject['versionFromChannel'] = {
          stable:  '1.96.3',
          latest:  '1.97.5',
          'v1.96': '1.96.3',
          'v1.97': '1.97.5',
        };

        return Promise.resolve(result);
      });
    subject['writeCache'] = jest.fn(() => Promise.resolve());

    // Fake out the results
    modules['node-fetch'].default
      .mockImplementationOnce((url) => {
        expect(url).toEqual(subject['channelApiUrl']);

        return Promise.resolve(new FetchResponse(
          JSON.stringify({
            resourceType: 'channels',
            data:         [
              {
                type: 'channel', name: 'v1.96', latest: '1.96.9+k3s1',
              },
              {
                type: 'channel', name: 'v1.97', latest: '1.97.7+k3s1',
              },
              {
                type: 'channel', name: 'stable', latest: '1.97.7+k3s1',
              },
              {
                type: 'channel', name: 'latest', latest: '1.98.3+k3s1',
              },
              {
                type: 'channel', name: 'v1.98', latest: '1.98.3+k3s1',
              },
            ],
          }),
        ));
      })
      .mockImplementationOnce((url) => {
        expect(url).toEqual(subject['releaseApiUrl']);

        return Promise.resolve(new FetchResponse(
          JSON.stringify([
            { tag_name: 'v1.98.3+k3s2', assets: validAssets },
            { tag_name: 'v1.98.2+k3s2', assets: validAssets },
            { tag_name: 'v1.98.1+k3s2', assets: validAssets },
            { tag_name: 'v1.97.7+k3s2', assets: validAssets },
            { tag_name: 'v1.97.6+k3s1', assets: validAssets },
          ]),
          { headers: { link: '<url>; rel="first"' } },
        ));
      })
      .mockImplementationOnce((url) => {
        throw new Error(`Unexpected fetch call to ${ url }`);
      });

    // Ensure the Latch is set up in K3sHelper
    subject.networkReady();

    await subject.initialize();
    expect(modules['node-fetch'].default).toHaveBeenCalledTimes(2);
    const availableVersions = await subject.availableVersions;

    expect(availableVersions).toEqual([
      new SemanticVersionEntry(new semver.SemVer('v1.98.3+k3s2'), ['latest', 'v1.98']),
      new SemanticVersionEntry(new semver.SemVer('v1.98.2+k3s2')),
      new SemanticVersionEntry(new semver.SemVer('v1.98.1+k3s2')),
      new SemanticVersionEntry(new semver.SemVer('v1.97.7+k3s2'), ['stable', 'v1.97']),
      new SemanticVersionEntry(new semver.SemVer('v1.97.6+k3s1')),
      new SemanticVersionEntry(new semver.SemVer('v1.97.5+k3s1')),
      new SemanticVersionEntry(new semver.SemVer('v1.97.4+k3s1')),
      new SemanticVersionEntry(new semver.SemVer('v1.97.3+k3s1')),
      new SemanticVersionEntry(new semver.SemVer('v1.97.2+k3s1')),
      new SemanticVersionEntry(new semver.SemVer('v1.97.1+k3s1')),
      new SemanticVersionEntry(new semver.SemVer('v1.96.3+k3s1'), ['v1.96']),
      new SemanticVersionEntry(new semver.SemVer('v1.96.2+k3s1')),
      new SemanticVersionEntry(new semver.SemVer('v1.96.1+k3s1')),
      new SemanticVersionEntry(new semver.SemVer('v1.96.0+k3s2')),
    ]);
  });

  describe('initialize', () => {
    it('should finish initialize without network if cache is available', async() => {
      const writer = new K3sHelper('x86_64');

      writer['versions'] = { 'v1.99.0': new SemanticVersionEntry(new semver.SemVer('v1.99.0')) };
      await writer['writeCache']();

      // We want to check that initialize() returns before updateCache() does.

      const subject = new K3sHelper('x86_64');
      const pendingInit = new Promise((resolve) => {
        // We need a cast on updateCache here since it's a protected method.
        jest.spyOn(subject, 'updateCache' as any).mockImplementation(async() => {
          // This will be called, but will not block initialization.
          await pendingInit;

          return [];
        });
        subject.initialize().then(resolve);
      });

      expect(await subject.availableVersions).toContainEqual({
        version:  semver.parse('v1.99.0'),
        channels: undefined,
      });
      await pendingInit;
    });
  });

  describe('selectClosestSemVer', () => {
    const subject = K3sHelper;
    const table = [
      ['finds the oldest newer major version', 'v3.1.2+k3s3',
        ['v1.2.9+k3s1', 'v1.2.9+k3s4', 'v4.2.8+k3s1', 'v4.3.0+k3s1'], 'v4.2.8+k3s1'],
      ['finds the oldest newer minor version', 'v1.12.2+k3s3',
        ['v1.2.9+k3s1', 'v1.7.0+k3s1', 'v1.29.9+k3s4', 'v2.12.8+k3s1'], 'v1.29.9+k3s4'],
      ['finds the oldest newer patch version at the start of the list', 'v1.12.2+k3s3',
        ['v1.12.4+k3s1', 'v1.12.4+k3s4', 'v1.12.8+k3s1', 'v1.12.9+k3s4'], 'v1.12.4+k3s4'],
      ['finds the oldest newer patch version inside the list', 'v1.12.10+k3s99',
        ['v1.12.4+k3s1', 'v1.12.8+k3s1', 'v1.12.9+k3s1', 'v1.12.20+k3s4'], 'v1.12.20+k3s4'],
      ['settles on the newest older version', 'v1.12.11+k3s5',
        ['v1.12.4+k3s1', 'v1.12.4+k3s4', 'v1.12.8+k3s1', 'v1.12.9+k3s4'], 'v1.12.9+k3s4'],
      ['favor a lower build number for same version over a newer version', 'v1.2.9+k3s2',
        ['v1.2.8+k3s1', 'v1.2.9+k3s1', 'v1.2.10+k3s1', 'v1.2.10+k3s2'], 'v1.2.9+k3s1'],
      ['finds the highest build version over single digits', 'v1.2.9+k3s2',
        ['v1.2.8+k3s1', 'v1.2.9+k3s1', 'v1.2.9+k3s4', 'v1.3.0+k3s1'], 'v1.2.9+k3s4'],
      ['finds the highest build version over double digits', 'v1.2.9+k3s11',
        ['v1.2.9+k3s9', 'v1.2.9+k3s15', 'v1.2.9+k3s16', 'v1.3.0+k3s1'], 'v1.2.9+k3s16'],
      ['can handle non-conforming inputs', 'v1.2.3+k3s4',
        ['v1.2.2+k3s1', 'oswald', 'rabbit', 'v1.2.4+k3s4'], 'v1.2.4+k3s4'],
    ] as const;

    test.each(table)('%s', (title: string, desiredVersion: string, cachedFilenames: readonly [string, string, string, string], expected: string) => {
      const desiredSemver = new semver.SemVer(desiredVersion);
      const selectedSemVer = subject['selectClosestSemVer'](desiredSemver, cachedFilenames as unknown as Array<string>);

      expect(selectedSemVer).toHaveProperty('raw', expected);
    });

    test('can handle zero choices', () => {
      const desiredSemver = new semver.SemVer('v1.99.3+k3s4');

      expect(() => subject['selectClosestSemVer'](desiredSemver, [])).toThrow(NoCachedK3sVersionsError);
    });
  });
});
