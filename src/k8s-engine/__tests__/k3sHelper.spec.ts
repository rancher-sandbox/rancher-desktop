import fs from 'fs';
import os from 'os';
import path from 'path';
import util from 'util';

import fetch from 'node-fetch';
import semver, { valid } from 'semver';
import { mocked } from 'ts-jest/utils';

import K3sHelper, { buildVersion, ReleaseAPIEntry } from '../k3sHelper';
import download from '../../utils/download';

const { Response: FetchResponse, Headers: FetchHeaders } = jest.requireActual('node-fetch');

// Mock fetch to ensure we never make an actual request.
jest.mock('node-fetch', () => {
  return jest.fn((...args) => {
    throw new Error('Unexpected network traffic');
  });
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
      subject = new K3sHelper();
      // Note that we _do not_ initialize this, i.e. we don't trigger an
      // initial fetch of the releases.  Instead, we pretend that is done.
      subject['pendingUpdate'] = Promise.resolve();
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
    const subject = new K3sHelper();
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
    const subject = new K3sHelper();
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
    const subject = new K3sHelper();
    const versionStrings = ['1.2.3+k3s1', '2.3.4+k3s3'];

    subject['versions'] = Object.fromEntries(versionStrings.map((s) => {
      const v = new semver.SemVer(s);

      return [`v${ v.version }`, v];
    }));
    expect(subject.fullVersion('1.2.3')).toEqual('1.2.3+k3s1');
    expect(() => subject.fullVersion('1.2.4')).toThrow('1.2.4');
    expect(() => subject.fullVersion('invalid version')).toThrow('not a valid version');
  });
  test('neededVersions', () => {
    const subject = new K3sHelper();
    const existingVersions = [1.17, 1.18, 1.20, 1.23, 1.27, 1.32, 2.0, 2.3];
    const currentVersions = ['v1.16.1+k3s1', 'v1.17.2-beta4', 'v1.18.3-alpha6', 'v1.19.4', 'v1.20.5',
      'v1.21.6', 'v1.22.7', 'v1.23.8', 'v1.24.9', 'v1.26.10', 'v1.27.11', 'v1.28.12',
      'v1.31.13', 'v1.32.14', 'v1.33.15'];

    for (const currentVersion of currentVersions) {
      expect(subject.getVersionIfNeeded(existingVersions, currentVersion)).toBe('');
    }
    expect(subject.getVersionIfNeeded(existingVersions, 'v1.15.1')).toBe('1.15');
    expect(subject.getVersionIfNeeded(existingVersions, 'v1.25.2')).toBe('1.25');
    expect(subject.getVersionIfNeeded(existingVersions, 'v1.29.3')).toBe('1.29');
    expect(subject.getVersionIfNeeded(existingVersions, 'v1.30.4')).toBe('1.30');
    expect(subject.getVersionIfNeeded(existingVersions, 'v1.34.5')).toBe('1.34');
  });
});
