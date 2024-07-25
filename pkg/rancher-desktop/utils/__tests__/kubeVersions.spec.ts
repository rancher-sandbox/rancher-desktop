import semver from 'semver';

import { highestStableVersion, minimumUpgradeVersion, SemanticVersionEntry, VersionEntry } from '@pkg/utils/kubeVersions';

describe('highestStableVersion', () => {
  it('should return the highest stable version', () => {
    const versions: VersionEntry[] = [
      { version: '2.0.0', channels: ['unstable'] },
      { version: '1.1.0', channels: ['stable'] },
      { version: '1.3.0', channels: ['stable'] },
      { version: '1.2.0', channels: ['stable'] },
    ];
    const result = highestStableVersion(versions)?.version;

    expect(result).toEqual('1.3.0');
  });

  it('should return highest version if no stable version is found', () => {
    const versions: VersionEntry[] = [
      { version: '1.0.0', channels: ['unstable'] },
      { version: '1.2.0', channels: ['beta'] },
      { version: '1.1.0', channels: ['beta'] },
    ];
    const result = highestStableVersion(versions)?.version;

    expect(result).toEqual('1.2.0');
  });

  it('should return undefined if the list is empty', () => {
    const result = highestStableVersion([]);

    expect(result).toBeUndefined();
  });
});

describe('minimumUpgradeVersion', () => {
  it('should return the highest patch release of the lowest major.minor version', () => {
    const versions: SemanticVersionEntry[] = [
      new SemanticVersionEntry(new semver.SemVer('v1.2.1'), ['stable']),
      new SemanticVersionEntry(new semver.SemVer('v1.0.0'), ['unstable']),
      new SemanticVersionEntry(new semver.SemVer('v1.0.3'), ['unstable']),
      new SemanticVersionEntry(new semver.SemVer('v1.0.2'), ['stable']),
      new SemanticVersionEntry(new semver.SemVer('v1.2.2'), ['stable']),
    ];
    const result = minimumUpgradeVersion(versions)?.version.version;

    expect(result).toEqual('1.0.3');
  });

  it('should return undefined if the list is empty', () => {
    const result = minimumUpgradeVersion([]);

    expect(result).toBeUndefined();
  });
});
