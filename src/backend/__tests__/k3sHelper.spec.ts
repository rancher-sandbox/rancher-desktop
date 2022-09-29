/** @jest-environment node */

import fs from 'fs';
import os from 'os';
import path from 'path';
import util from 'util';

import fetch from 'node-fetch';
import semver from 'semver';

import K3sHelper, {
  buildVersion, ChannelMapping, NoCachedK3sVersionsError, ReleaseAPIEntry, VersionEntry,
} from '../k3sHelper';

import paths from '@/utils/paths';

const cachePath = path.join(paths.cache, 'k3s-versions.json');
const { Response: FetchResponse } = jest.requireActual('node-fetch');

// Mock fetch to ensure we never make an actual request.
jest.mock('node-fetch', () => {
  return jest.fn((...args) => {
    throw new Error('Unexpected network traffic');
  });
});

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
  jest.mocked(fetch).mockClear();
});

describe(buildVersion, () => {
  test('parses the build number', () => {
    expect(buildVersion(new semver.SemVer('v1.2.3+k3s4'))).toEqual(4);
  });

  test('handles non-conforming versions', () => {
    expect(buildVersion(new semver.SemVer('v1.2.3'))).toEqual(-1);
  });
});

describe(K3sHelper, () => {
  describe('processVersion', () => {
    let subject: K3sHelper;
    const process = (name: string, existing: string[] = [], hasAssets = false) => {
      const assets: ReleaseAPIEntry['assets'] = [];

      if (hasAssets) {
        for (const name of Object.values(subject['filenames'])) {
          assets.push({ name, browser_download_url: name });
        }
      }

      for (const version of existing) {
        const parsed = new semver.SemVer(version);

        subject['versions'][parsed.version] = new VersionEntry(parsed);
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
      expect(process('1.2.3-beta1')).toEqual(true);
      expect(await subject.availableVersions).toHaveLength(0);
    });
    it('should skip valid but erroneous versions', async () => {
      expect(process('1.2.3+rk3s1')).toEqual(true);
      expect(await subject.availableVersions).toHaveLength(0);
    });
    it('should ignore old versions', async() => {
      expect(process('0.2.0')).toEqual(true);
      expect(await subject.availableVersions).toHaveLength(0);
    });
    it('should ignore obsolete builds', async() => {
      expect(process('1.2.3_k3s4', ['1.2.3+k3s5'])).toEqual(true);
      expect(await subject.availableVersions).toHaveLength(1);
    });
    it('should ignore existing builds', async() => {
      expect(process('1.2.3+k3s4', ['1.2.3+k3s4'])).toEqual(false);
      expect(await subject.availableVersions).toHaveLength(1);
    });
    it('should ignore versions with missing assets', async() => {
      expect(process('1.2.3+k3s4')).toEqual(true);
      expect(await subject.availableVersions).toHaveLength(0);
    });
    it('should add versions', async() => {
      expect(process('1.2.3+k3s4', [], true)).toEqual(true);
      expect(await subject.availableVersions).toHaveLength(1);
    });
  });

  test('cache read/write', async() => {
    const subject = new K3sHelper('x86_64');
    const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rd-test-cache-'));
    const versions: Record<string, VersionEntry> = {
      '1.2.3': new VersionEntry(semver.parse('1.2.3+k3s1') as semver.SemVer, ['stable']),
      '2.3.4': new VersionEntry(semver.parse('2.3.4+k3s3') as semver.SemVer),
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
      expect(channels).toEqual({ stable: '1.2.3' });

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
    const validAssets = Object.values(subject['filenames'])
      .map(name => ({ name, browser_download_url: name }));

    // Override cache reading to return a fake existing cache.
    // The first read returns nothing to trigger a synchronous update;
    // the rest fo the reads return mocked values.
    subject['readCache'] = jest.fn()
      .mockResolvedValueOnce(undefined)
      .mockImplementation(function(this: K3sHelper) {
        const result = new ChannelMapping();

        for (const [version, tags] of Object.entries({
          'v1.2.1+k3s1': ['stale-tag'],
          'v1.2.3+k3s1': ['stable'],
        })) {
          const parsedVersion = new semver.SemVer(version);

          this.versions[parsedVersion.version] = new VersionEntry(parsedVersion, tags);
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
    jest.mocked(fetch)
      .mockImplementationOnce((url) => {
        expect(url).toEqual(subject['channelApiUrl']);

        return Promise.resolve(new FetchResponse(
          JSON.stringify({
            data: [{
              name:   'stable',
              latest: 'v1.2.3+k3s3',
            }],
          }),
        ));
      })
      .mockImplementationOnce((url) => {
        expect(url).toEqual(subject['releaseApiUrl']);

        return Promise.resolve(new FetchResponse(
          JSON.stringify([
            { tag_name: 'v1.2.3+k3s2', assets: validAssets },
            { tag_name: 'v1.2.3+k3s3', assets: validAssets },
            // The next one is skipped because there's a newer build
            { tag_name: 'v1.2.3+k3s1', assets: validAssets },
            { tag_name: 'v1.2.4+k3s1', assets: [] },
            { tag_name: 'v1.2.1+k3s2', assets: validAssets },
          ]),
          { headers: { link: '<url>; rel="next"' } },
        ));
      })
      .mockImplementationOnce((url) => {
        expect(url).toEqual('url');

        return Promise.resolve(new FetchResponse(
          null,
          { status: 403, headers: { 'X-RateLimit-Remaining': '0' } },
        ));
      })
      .mockImplementationOnce((url) => {
        expect(url).toEqual('url');

        return Promise.resolve(new FetchResponse(
          JSON.stringify([
            { tag_name: 'Invalid tag name', assets: validAssets },
            { tag_name: 'v1.2.0+k3s5', assets: validAssets },
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
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(subject['delayForWaitLimiting']).toHaveBeenCalledTimes(1);
    expect(await subject.availableVersions).toEqual([
      new VersionEntry(new semver.SemVer('v1.2.3+k3s3'), ['stable']),
      new VersionEntry(new semver.SemVer('v1.2.1+k3s2')),
      new VersionEntry(new semver.SemVer('v1.2.0+k3s5')),
    ]);
  });

  describe('initialize', () => {
    it('should finish initialize without network if cache is available', async() => {
      const writer = new K3sHelper('x86_64');

      writer['versions'] = { 'v1.0.0': new VersionEntry(new semver.SemVer('v1.0.0')) };
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
        version:  semver.parse('v1.0.0'),
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
        ['v1.2.9+k3s1', 'v1.7.0+k3s1', 'v1.23.9+k3s4', 'v2.12.8+k3s1'], 'v1.23.9+k3s4'],
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
      const desiredSemver = new semver.SemVer('v1.2.3+k3s4');

      expect(() => subject['selectClosestSemVer'](desiredSemver, [])).toThrowError(NoCachedK3sVersionsError);
    });
  });
});
