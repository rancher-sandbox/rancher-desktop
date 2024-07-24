import semver from 'semver';

export interface VersionEntry {
  /**
   * The version being described. This includes any build-specific data.
   * This must be a valid semver-parsable string, without any pre-release
   * versions or build metadata.
   */
  version: string;
  /** A string describing the channels that include this version, if any. */
  channels?: string[];
}

/**
 * SemanticVersionEntry is a VersionEntry that contains semver.SemVer objects.
 * This should not be passed over IPC.
 */
export interface SemanticVersionEntry extends Omit<VersionEntry, 'version'> {
  /**
   * The version being described. This includes any build-specific data.
   */
  version: semver.SemVer;
}

/**
 * Get the highest stable version from a list of K8s.VersionEntry objects.
 * @param versions The list of K8s.VersionEntry objects.
 * @returns The highest stable version, or highest version if no stable version is found.
 */
export function highestStableVersion(versions: VersionEntry[]): VersionEntry | undefined {
  const highestFirst = versions.slice().sort((a, b) => semver.compare(b.version, a.version));

  return highestFirst.find(v => (v.channels ?? []).includes('stable')) ?? highestFirst[0];
}

function sameMajorMinorVersion(version1: semver.SemVer, version2: semver.SemVer): boolean {
  return version1.major === version2.major && version1.minor === version2.minor;
}

/**
 * Get the highest patch release of the lowest available versions
 * @param versions The list of K8s.VersionEntry objects.
 * @returns The highest patch version.
 */
export function minimumUpgradeVersion(versions: SemanticVersionEntry[]): SemanticVersionEntry | undefined {
  // See comment on highestStableVersion about versions[].version potentially not being a semver.SemVer object.
  const lowestFirst = versions.slice().sort((a, b) => semver.compare(a.version, b.version));

  return lowestFirst.findLast(v => sameMajorMinorVersion(v.version, lowestFirst[0].version));
}
