import semver from 'semver';

import K3sVersionLister, { buildVersion, ReleaseAPIEntry } from '../k3sVersions';

describe(buildVersion, () => {
  test('parses the build number', () => {
    expect(buildVersion(new semver.SemVer('v1.2.3+k3s4'))).toEqual(4);
  });
  test('handles non-conforming versions', () => {
    expect(buildVersion(new semver.SemVer('v1.2.3'))).toEqual(-1);
  });
});

describe(K3sVersionLister, () => {
  describe('processVersion', () => {
    let subject: K3sVersionLister;
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
      subject = new K3sVersionLister();
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
      expect(process('0.0.1')).toEqual(true);
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
});
