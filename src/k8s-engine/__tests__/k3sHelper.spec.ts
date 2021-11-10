import fs from 'fs';
import os from 'os';
import path from 'path';
import util from 'util';

import fetch from 'node-fetch';
import semver from 'semver';
import { mocked } from 'ts-jest/utils';

import paths from '@/utils/paths';
import K3sHelper, { buildVersion, ReleaseAPIEntry } from '../k3sHelper';

const cachePath = path.join(paths.cache, 'k3s-versions.json');
const { Response: FetchResponse } = jest.requireActual('node-fetch');

// Mock fetch to ensure we never make an actual request.
jest.mock('node-fetch', () => {
  return jest.fn((...args) => {
    throw new Error('Unexpected network traffic');
  });
});

let cacheData: Buffer|null;

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
  mocked(fetch).mockClear();
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
        for (const name of subject['filenames']) {
          assets.push({ name, browser_download_url: name });
        }
      }

      for (const version of existing) {
        const parsed = new semver.SemVer(version);

        subject['versions'][`v${ parsed.version }`] = parsed;
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
    const readFile = util.promisify(fs.readFile);
    const mkdtemp = util.promisify(fs.mkdtemp);
    const workDir = await mkdtemp(path.join(os.tmpdir(), 'rd-test-cache-'));
    // This must be sorted in semver order.
    const versionStrings = ['1.2.3+k3s1', '2.3.4+k3s3'];
    const versions = Object.fromEntries(versionStrings.map((s) => {
      const v = new semver.SemVer(s);

      return [`v${ v.version }`, v];
    }));

    try {
      // We need to cast to any in order to override readonly.
      (subject as any).cachePath = path.join(workDir, 'cache.json');
      subject['versions'] = {};
      Object.assign(subject['versions'], versions);
      await subject['writeCache']();

      const actual = JSON.parse(await readFile(subject['cachePath'], 'utf8'));

      expect(semver.sort(actual)).toEqual(versionStrings);

      // Check that we can load the values back properly
      subject['versions'] = {};
      await subject['readCache']();
      expect(subject['versions']).toEqual(versions);
    } finally {
      await util.promisify(fs.rmdir)(workDir, { recursive: true });
    }
  });

  test('updateCache', async() => {
    const subject = new K3sHelper('x86_64');
    const validAssets = subject['filenames']
      .map(name => ({ name, browser_download_url: name }));

    // Stub out touching the cache; not used for this.
    subject['readCache'] = jest.fn(() => Promise.resolve());
    subject['writeCache'] = jest.fn(() => Promise.resolve());
    // On rate limiting, continue immediately.
    subject['delayForWaitLimiting'] = jest.fn(() => Promise.resolve());

    // Fake out the results
    mocked(fetch)
      .mockImplementationOnce((url) => {
        return Promise.resolve(new FetchResponse(
          JSON.stringify([
            { tag_name: 'v1.2.3+k3s2', assets: validAssets },
            { tag_name: 'v1.2.3+k3s3', assets: validAssets },
            // The next one is skipped because there's a newer build
            { tag_name: 'v1.2.3+k3s1', assets: validAssets },
            { tag_name: 'v1.2.4+k3s1', assets: [] },
            { tag_name: 'v1.2.1+k3s2', assets: validAssets },
          ]),
          { headers: { link: '<url>; rel="next"' } }
        ));
      })
      .mockImplementationOnce((url) => {
        expect(url).toEqual('url');

        return Promise.resolve(new FetchResponse(
          null,
          { status: 403, headers: { 'X-RateLimit-Remaining': '0' } }
        ));
      })
      .mockImplementationOnce((url) => {
        expect(url).toEqual('url');

        return Promise.resolve(new FetchResponse(
          JSON.stringify([
            { tag_name: 'Invalid tag name', assets: validAssets },
            { tag_name: 'v1.2.0+k3s5', assets: validAssets },
          ]),
          { headers: { link: '<url>; rel="first"' } }
        ));
      })
      .mockImplementationOnce((url) => {
        throw new Error(`Unexpected fetch call to ${ url }`);
      });
    await subject.initialize();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(subject['delayForWaitLimiting']).toHaveBeenCalledTimes(1);
    expect(subject['versions']).toEqual({
      'v1.2.3': new semver.SemVer('v1.2.3+k3s3'),
      'v1.2.1': new semver.SemVer('v1.2.1+k3s2'),
      'v1.2.0': new semver.SemVer('v1.2.0+k3s5'),
    });
    expect(await subject.availableVersions).toEqual(['v1.2.3', 'v1.2.1', 'v1.2.0']);
  });

  test('fullVersion', () => {
    const subject = new K3sHelper('x86_64');
    const versionStrings = ['1.2.3+k3s1', '2.3.4+k3s3'];

    subject['versions'] = Object.fromEntries(versionStrings.map((s) => {
      const v = new semver.SemVer(s);

      return [`v${ v.version }`, v];
    }));
    expect(subject.fullVersion('1.2.3')).toEqual('1.2.3+k3s1');
    expect(() => subject.fullVersion('1.2.4')).toThrow('1.2.4');
    expect(() => subject.fullVersion('invalid version')).toThrow('not a valid version');
  });

  describe('initialize', () => {
    it('should finish initialize without network if cache is available', async() => {
      const writer = new K3sHelper('x86_64');

      writer['versions'] = { 'v1.0.0': new semver.SemVer('v1.0.0') };
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

      expect(await subject.availableVersions).toContain('v1.0.0');
      await pendingInit;
    });
  });
});
