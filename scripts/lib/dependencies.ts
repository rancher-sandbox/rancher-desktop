import fs from 'fs';
import os from 'os';
import path from 'path';

import { ThrottlingOptions } from '@octokit/plugin-throttling';
import { Octokit } from 'octokit';
import semver from 'semver';
import YAML from 'yaml';

import { download, getResource, hashFile } from './download';

export type DependencyPlatform = 'wsl' | 'linux' | 'darwin' | 'win32';
export type Platform = 'linux' | 'darwin' | 'win32';
export type GoPlatform = 'linux' | 'darwin' | 'windows';

export interface DownloadContext {
  dependencies:       DependencyManifest;
  dependencyPlatform: DependencyPlatform;
  platform:           Platform;
  goPlatform:         GoPlatform;
  // whether we are running on M1
  isM1:               boolean;
  // resourcesDir is the directory that external dependencies and the like go into
  resourcesDir:       string;
  // binDir is for binaries that the user will execute
  binDir:             string;
  // internalDir is for binaries that RD will execute behind the scenes
  internalDir:        string;
  // dockerPluginsDir is for docker CLI plugins.
  dockerPluginsDir:   string;
}

export interface AlpineLimaISOVersion {
  // The version of the ISO build
  isoVersion:    string;
  // The version of Alpine Linux that the ISO is built on
  alpineVersion: string
}

export interface MobyOpenAPISpecVersion {
  // The Docker API version, e.g. "1.54", which selects the
  // `api/docs/v${apiVersion}.yaml` file to read.
  apiVersion: string;
  // The Moby commit the spec is fetched from.  rddepman resolves the latest
  // commit that touched `api/docs/v${apiVersion}.yaml` at bump time and pins
  // it here so the source URL is immutable for install-time verification.
  commit:     string;
}

export type Version = string | AlpineLimaISOVersion | MobyOpenAPISpecVersion;

export interface DependencyVersions {
  lima:                            string;
  qemu:                            string;
  socketVMNet:                     string;
  alpineLimaISO:                   AlpineLimaISOVersion;
  WSLDistro:                       string;
  kuberlr:                         string;
  helm:                            string;
  dockerCLI:                       string;
  dockerBuildx:                    string;
  dockerCompose:                   string;
  'golangci-lint':                 string;
  trivy:                           string;
  steve:                           string;
  rancherDashboard:                string;
  dockerProvidedCredentialHelpers: string;
  ECRCredentialHelper:             string;
  mobyOpenAPISpec:                 MobyOpenAPISpecVersion;
  wix:                             string;
  moproxy:                         string;
  spinShim:                        string;
  certManager:                     string;
  spinOperator:                    string;
  spinCLI:                         string;
  spinKubePlugin:                  string;
  'check-spelling':                string;
}

export const DEP_VERSIONS_PATH = 'pkg/rancher-desktop/assets/dependencies.yaml';

/**
 * A sha256 checksum as stored in `dependencies.yaml`, including the algorithm
 * prefix.  The prefix documents the algorithm for readers of the file; the
 * install path strips it and treats the remainder as sha256 hex.  Values
 * carry lowercase hex; {@link parseSha256Checksum} normalizes on parse so
 * `download()` can compare against `crypto.createHash('sha256').digest('hex')`
 * (always lowercase) with a plain `===`.
 */
export type Sha256Checksum = `sha256:${ string }`;

/**
 * Parses a raw string as a {@link Sha256Checksum}.  Throws unless the value
 * has the form `sha256:<64 hex chars>`.  Uppercase hex parses but normalizes
 * to lowercase so consumers can compare with `===`.
 */
export function parseSha256Checksum(value: unknown): Sha256Checksum {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/i.test(value)) {
    throw new Error(`Invalid sha256 checksum ${ JSON.stringify(value) }; expected "sha256:<64 hex chars>"`);
  }

  return value.toLowerCase() as Sha256Checksum;
}

/**
 * The compound entry recorded for each dependency in `dependencies.yaml`:
 * the version (typed per dependency) plus a map from artifact filename to
 * its stored {@link Sha256Checksum}.  Filenames match what upstream
 * publishes — the same string a `sha256sum` or `sha512sum` file uses.
 */
export interface DependencyEntry<K extends keyof DependencyVersions = keyof DependencyVersions> {
  version:   DependencyVersions[K];
  checksums: Record<string, Sha256Checksum>;
}

/**
 * The parsed contents of `dependencies.yaml`, keyed by dependency name.
 * The shape mirrors the on-disk YAML so the in-memory model and the file
 * stay in sync without translation.
 */
export type DependencyManifest = {
  [K in keyof DependencyVersions]: DependencyEntry<K>;
};

interface RawEntry {
  version:    unknown;
  checksums?: Record<string, unknown>;
}

/** Reads `dependencies.yaml` into the typed compound manifest. */
export async function readDependencyManifest(path: string): Promise<DependencyManifest> {
  const raw: Record<string, RawEntry> = YAML.parse(await fs.promises.readFile(path, 'utf-8'));
  const manifest: Partial<DependencyManifest> = {};

  for (const [name, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== 'object' || !('version' in entry)) {
      throw new Error(`Entry ${ name } in ${ path } is missing a "version" field`);
    }
    const version = entry.version;
    const valid = typeof version === 'string' ||
      (typeof version === 'object' && version !== null && !Array.isArray(version));

    if (!valid) {
      throw new Error(`Entry ${ name } in ${ path } has invalid version ${ JSON.stringify(version) }; expected a string or object`);
    }
    const checksums: Record<string, Sha256Checksum> = {};

    for (const [file, value] of Object.entries(entry.checksums ?? {})) {
      checksums[file] = parseSha256Checksum(value);
    }
    (manifest as any)[name] = {
      version,
      checksums,
    };
  }

  return manifest as DependencyManifest;
}

// Split the editor-warning marker across array entries so this source file
// itself stays unflagged; the joined output reassembles it for editors that
// scan the YAML.
const MANIFEST_HEADER = [
  '# Regenerated by `yarn rddepman` on every dependency bump.  DO NOT ',
  'EDIT.\n',
  '# Manual edits must recompute the affected sha256 entries; stale digests\n',
  '# fail postinstall verification.  Document non-obvious version pins in\n',
  '# scripts/dependencies/<name>.ts instead of inline comments here — the\n',
  '# next bump will strip them.\n',
  '#\n',
  '# Each entry pairs a version with a checksums map of upstream artifact\n',
  '# filenames; install-time downloads verify against the stored sha256.\n',
].join('');

/**
 * Writes the manifest to disk in compound-entry form and invalidates the
 * shared cache so subsequent reads observe the new contents.  Always emits a
 * leading header comment so contributors editing the YAML directly see the
 * warning where they are editing; everything else round-trips through
 * `YAML.stringify`, which drops any other comments on the next rddepman bump.
 */
export async function writeDependencyManifest(path: string, manifest: DependencyManifest): Promise<void> {
  await fs.promises.writeFile(path, MANIFEST_HEADER + YAML.stringify(manifest), { encoding: 'utf-8' });
  if (path === DEP_VERSIONS_PATH) {
    depManifestCache = undefined;
  }
}

/**
 * Convenience wrapper for callers that only need versions (`lint-go`,
 * `docker-cli-monitor`).
 */
export async function readDependencyVersions(path: string): Promise<DependencyVersions> {
  const manifest = await readDependencyManifest(path);
  const versions: Partial<DependencyVersions> = {};

  for (const name of Object.keys(manifest) as (keyof DependencyVersions)[]) {
    (versions as any)[name] = manifest[name].version;
  }

  return versions as DependencyVersions;
}

/**
 * Returns the stored sha256 for the given artifact as raw hex, with the
 * `sha256:` prefix stripped so it slots straight into `download()`.  Throws
 * if the artifact has no recorded checksum.
 */
export function lookupChecksum(
  context: DownloadContext,
  name: keyof DependencyVersions,
  artifactName: string,
): string {
  const entry = context.dependencies[name];

  if (!entry) {
    throw new Error(`Dependency "${ name }" is not present in ${ DEP_VERSIONS_PATH }.`);
  }
  const prefixed = entry.checksums?.[artifactName];

  if (!prefixed) {
    const available = Object.keys(entry.checksums ?? {}).sort().join(', ') || '(none)';

    throw new Error(
      `No checksum recorded for ${ name } artifact "${ artifactName }" in ${ DEP_VERSIONS_PATH }. ` +
      `Available: ${ available }`,
    );
  }

  return prefixed.slice('sha256:'.length);
}

/**
 * Downloads `url` to a temporary file, hashes it with sha256, and returns the
 * prefixed checksum.  When `options.verify` is provided, also hashes the file
 * with the given algorithm and confirms it matches the expected value;
 * rddepman uses this to cross-check upstream checksum files at bump time.
 */
export async function downloadAndHash(
  url: string,
  options: { verify?: { algorithm: 'sha256' | 'sha512', expected: string | undefined } } = {},
): Promise<Sha256Checksum> {
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rddepman-'));
  const tempPath = path.join(workDir, 'artifact');

  try {
    await download(url, tempPath, { overwrite: true, access: fs.constants.W_OK });

    const sha256 = await hashFile(tempPath, 'sha256');

    if (options.verify) {
      if (!options.verify.expected) {
        throw new Error(
          `No upstream ${ options.verify.algorithm } checksum found for ${ url }. ` +
          `The sidecar checksum file did not list this artifact (filename mismatch, ` +
          `unsupported sidecar format, or missing entry).`,
        );
      }

      const actual = options.verify.algorithm === 'sha256'
        ? sha256
        : await hashFile(tempPath, options.verify.algorithm);

      if (actual !== options.verify.expected) {
        // Preserve the bytes outside workDir before the finally cleanup
        // removes them, so the maintainer can inspect what was served
        // (often an HTML error page or a CDN redirect, not the artifact).
        const basename = path.basename(new URL(url).pathname) || 'artifact';
        const keepPath = path.join(os.tmpdir(), `rddepman-mismatch-${ basename }`);

        await fs.promises.copyFile(tempPath, keepPath);
        throw new Error(
          `Upstream checksum mismatch for ${ url }: ` +
          `expected ${ options.verify.algorithm }:${ options.verify.expected }, got ${ options.verify.algorithm }:${ actual }. ` +
          `Received bytes saved to ${ keepPath } for inspection.`,
        );
      }
    }

    return `sha256:${ sha256 }`;
  } finally {
    await fs.promises.rm(workDir, { recursive: true, maxRetries: 10 });
  }
}

/**
 * Fetches a `sha256sum` or `sha512sum` file and returns a map from filename
 * to raw hex checksum.  Recognizes GNU `<hex> [* ]<filename>` and BSD
 * `<ALG> (<filename>) = <hex>` line formats.  Indexes each entry by its
 * full path, plus by its basename when no other entry shares that
 * basename, so callers that know an artifact by filename alone still
 * find it in sidecars that embed a path prefix (e.g. `release/foo.tar.gz`).
 * Hex digits are normalised to lowercase to match the form
 * `downloadAndHash` returns.  `algorithm` filters lines whose hex width
 * (GNU) or BSD prefix does not match, so a `.sha512sum` URL pointed at
 * a sha256 sidecar fails parse rather than verify.
 */
export async function fetchUpstreamChecksums(url: string, algorithm: 'sha256' | 'sha512'): Promise<Record<string, string>> {
  const body = await getResource(url);
  const result: Record<string, string> = {};
  // Anchor to the requested algorithm's hex width (sha256 = 64, sha512 = 128)
  // and BSD prefix so a sidecar pointed at the wrong algorithm fails parse
  // rather than verify, and stray md5/sha1 entries cannot smuggle through.
  const hexWidth = algorithm === 'sha256' ? 64 : 128;
  const gnuLine = new RegExp(`^([0-9a-fA-F]{${ hexWidth }})\\s+\\*?(.+?)\\s*$`);
  const bsdLine = new RegExp(`^${ algorithm.toUpperCase() }\\s*\\((.+?)\\)\\s*=\\s*([0-9a-fA-F]{${ hexWidth }})\\s*$`);

  for (const line of body.split(/\r?\n/)) {
    let hex: string | undefined;
    let fullName: string | undefined;

    const gnu = gnuLine.exec(line);

    if (gnu) {
      [, hex, fullName] = gnu;
    } else {
      const bsd = bsdLine.exec(line);

      if (bsd) {
        [, fullName, hex] = bsd;
      }
    }

    if (hex && fullName) {
      result[fullName] = hex.toLowerCase();
    }
  }

  // Add basename aliases so callers that know an artifact by filename
  // alone still find it in sidecars that embed a path prefix.  Skip the
  // alias when two entries share a basename across paths; otherwise the
  // second write would silently overwrite the first and produce a
  // misleading mismatch error at verification time.
  const basenameCounts: Record<string, number> = {};

  for (const fullName of Object.keys(result)) {
    const basename = fullName.replace(/^.*\//, '');

    basenameCounts[basename] = (basenameCounts[basename] ?? 0) + 1;
  }
  for (const fullName of Object.keys(result)) {
    const basename = fullName.replace(/^.*\//, '');

    if (basenameCounts[basename] === 1 && !(basename in result)) {
      result[basename] = result[fullName];
    }
  }

  if (Object.keys(result).length === 0) {
    throw new Error(`Could not find any ${ algorithm } checksum entries in ${ url }; verify the sidecar format.`);
  }

  return result;
}

/**
 * A dependency is some binary that we need to track.  Generally this is some
 * third-party software, but it may also be things we build in an external
 * repository, or some binary we build from them.
 */
export interface Dependency {
  /** The name of this dependency. */
  get name(): string,
  /**
   * Other dependencies this one requires.
   * This must be in the form <name>:<platform>, e.g. "kuberlr:linux"
   */
  dependencies?: (context: DownloadContext) => string[],
  /**
   * Download this dependency.  Note that for some dependencies, this actually
   * builds from source.
   */
  download(context: DownloadContext): Promise<void>
}

/**
 * A VersionedDependency is a {@link Dependency} where we track a version and
 * can be automatically upgraded (i.e. a pull request made to bump the version).
 */
export abstract class VersionedDependency implements Dependency {
  abstract get name(): string;
  abstract download(context: DownloadContext): Promise<void>;
  /**
   * Returns the available versions of the Dependency.
   */
  abstract getAvailableVersions(): Promise<Version[]>;

  /** The current version. */
  abstract get currentVersion(): Promise<Version>;

  /** The newest version that can be upgraded to. */
  get latestVersion(): Promise<Version> {
    return (async() => {
      const availableVersions = await this.getAvailableVersions();

      return availableVersions.reduce((version1, version2) => {
        return this.rcompareVersions(version1, version2) < 0 ? version1 : version2;
      });
    })();
  }

  /** Whether we can upgrade. */
  get canUpgrade(): Promise<boolean> {
    return (async() => {
      const current = await this.currentVersion;
      const latest = await this.latestVersion;
      const compare = this.rcompareVersions(current, latest);

      if (compare < 0) {
        throw new Error(`${ this.name } at ${ current }, is greater than latest version ${ latest }`);
      }

      return compare > 0;
    })();
  }

  /**
   * Returns the sha256 of every artifact for the given version, verifying
   * each against any upstream checksum file the source publishes.  rddepman
   * calls this at bump time and stores the result in `dependencies.yaml`.
   * Classes that download nothing (e.g. `check-spelling`) return an empty map.
   */
  abstract getChecksums(version: Version): Promise<Record<string, Sha256Checksum>>;

  /**
   * Update the version manifest (e.g. `dependencies.yaml`) for this dependency,
   * in preparation for making a pull request.
   * @returns The set of files that have been modified.
   */
  abstract updateManifest(newVersion: Version, newChecksums: Record<string, Sha256Checksum>): Promise<Set<string>>;

  /**
   * Compare the two versions.  The return value is:
   * Value | Description
   * --- | ---
   * -1 | `version1` is higher
   * 0 | `version1` and `version2` are equal
   * 1 | `version2` is higher
   *
   * The default implementation compares version strings that look like `0.1.2.rd3????`.
   * Note that anything after the number after `rd` is ignored.
   */
  rcompareVersions(version1: Version, version2: Version): -1 | 0 | 1 {
    if (typeof version1 !== 'string' || typeof version2 !== 'string') {
      throw new TypeError(`default rcompareVersions only handles string versions (got ${ version1 } / ${ version2 })`);
    }

    const semver1 = semver.coerce(version1);
    const semver2 = semver.coerce(version2);

    if (semver1 === null || semver2 === null) {
      throw new Error(`One of ${ version1 } and ${ version2 } failed to be coerced to semver`);
    }

    if (semver1.raw !== semver2.raw) {
      return semver.rcompare(semver1, semver2);
    }

    // If the two versions are equal, assume we have different build suffixes
    // e.g. "0.19.0.rd5" vs "0.19.0.rd6"
    const [, match1] = /^\d+\.\d+\.\d+\.rd(\d+)$/.exec(version1) ?? [];
    const [, match2] = /^\d+\.\d+\.\d+\.rd(\d+)$/.exec(version2) ?? [];

    if (!match1 && !match2) {
      // Neither have .rd suffix; treat as equal.
      return 0;
    }
    if (!match1 || !match2) {
      // One of the two is invalid; prefer the valid one.
      return match1 ? -1 : match2 ? 1 : 0;
    }

    return Math.sign(parseInt(match2, 10) - parseInt(match1, 10)) as -1 | 0 | 1;
  }

  /** Format the version as a string for display. */
  static versionString(v: Version): string {
    if (typeof v === 'string') {
      return v;
    }
    if ('isoVersion' in v) {
      return v.isoVersion;
    }

    return v.apiVersion;
  }
}

/** Shared cache so all GlobalDependency subclasses read DEP_VERSIONS_PATH once. */
let depManifestCache: Promise<DependencyManifest> | undefined;

function getCachedManifest(): Promise<DependencyManifest> {
  depManifestCache ||= readDependencyManifest(DEP_VERSIONS_PATH);

  return depManifestCache;
}

/**
 * A GlobalDependency is a dependency where the version is managed in the file
 * {@link DEP_VERSIONS_PATH}.
 */
export function GlobalDependency<T extends abstract new(...args: any[]) => VersionedDependency>(Base: T) {
  abstract class GlobalDependency extends Base {
    /** The name of this dependency; it must be a key in DEP_VERSIONS_PATH. */
    abstract name: keyof DependencyVersions;

    get currentVersion(): Promise<Version> {
      return getCachedManifest().then(m => m[this.name].version);
    }

    async updateManifest(newVersion: Version, newChecksums: Record<string, Sha256Checksum>): Promise<Set<string>> {
      const manifest = await getCachedManifest();

      // The cast trusts the subclass to pass a Version that matches its
      // own DependencyVersions field; rddepman builds the call from
      // `dep.getChecksums(latestVersion)` whose return type already
      // depends on the dependency's own version shape.
      (manifest as any)[this.name] = { version: newVersion, checksums: newChecksums };
      await writeDependencyManifest(DEP_VERSIONS_PATH, manifest);

      return new Set([DEP_VERSIONS_PATH]);
    }
  }

  return GlobalDependency;
}

/**
 * A filter for GitHub releases.  Available options are:
 * Value | Description
 * --- | ---
 * `published` | Get GitHub releases (excluding versions marked as *pre-release* on GitHub).
 * `published-pre` | Get GitHub releases (including those marked as *pre-release* on GitHub).
 * `semver` | GitHub releases, excluding those marked as *pre-release*, or those with semver pre-release parts.
 * `custom` | The implementation must override `getAvailableVersions()`.
 */
type ReleaseFilter = 'published' | 'published-pre' | 'semver' | 'custom';

/**
 * A {@link VersionedDependency} using GitHub releases.
 */
export abstract class GitHubDependency extends VersionedDependency {
  /** The owner / organization on GitHub. */
  abstract get githubOwner(): string;
  /** The repository name (without the owner) on GitHub. */
  abstract get githubRepo(): string;

  /** Control how to get available releases; defaults to semver. */
  readonly releaseFilter: ReleaseFilter = 'semver';
  /**
   * Converts a version (of the format that is stored in dependencies.yaml)
   * to a tag that is used in a GitHub release.
   * The default implementation adds a `v` prefix to the version string.
   */
  versionToTagName(version: Version): string {
    return `v${ version }`;
  }

  async getAvailableVersions(): Promise<Version[]> {
    if (this.releaseFilter === 'custom') {
      throw new Error('class does not override getAvailableVersions()');
    }

    const tags = await getPublishedReleaseTagNames(this.githubOwner, this.githubRepo, this.releaseFilter);

    return tags.map(tag => tag.replace(/^v/, ''));
  }
}

export interface HasUnreleasedChangesResult { latestReleaseTag: string, hasUnreleasedChanges: boolean }

export type GitHubRelease = Awaited<ReturnType<Octokit['rest']['repos']['listReleases']>>['data'][0];

let _octokit: Octokit | undefined;
let _octokitAuthToken: string | undefined;

/**
 * Get a cached instance of Octokit, or create a new one as needed.  If the given token does not
 * match the one used to create the cached instance, a new one is created (and cached).
 * @param personalAccessToken Optional GitHub personal access token; defaults to GITHUB_TOKEN.
 */
export function getOctokit(personalAccessToken?: string): Octokit {
  personalAccessToken ||= process.env.GITHUB_TOKEN;

  if (!personalAccessToken) {
    throw new Error('Please set GITHUB_TOKEN to a PAT to check versions of github-based dependencies.');
  }

  if (_octokit && _octokitAuthToken === personalAccessToken) {
    return _octokit;
  }

  function makeLimitHandler(type: string, maxRetries: number): NonNullable<ThrottlingOptions['onSecondaryRateLimit']> {
    return (retryAfter, options, octokit, retryCount) => {
      function getOpt(prop: string) {
        return options && (prop in options) ? (options as any)[prop] : `(unknown ${ prop })`;
      }

      let message = `Request ${ type } limit exhausted for request`;
      let retry = false;

      message += ` ${ getOpt('method') } ${ getOpt('url') }`;

      if (retryCount < maxRetries) {
        retry = true;
        message += ` (retrying after ${ retryAfter } seconds: ${ retryCount }/${ maxRetries } retries)`;
      } else {
        message += ` (not retrying after ${ maxRetries } retries)`;
      }

      octokit.log.warn(message);

      return retry;
    };
  }

  _octokit = new Octokit({
    auth:     personalAccessToken,
    throttle: {
      onRateLimit:          makeLimitHandler('primary', 3),
      onSecondaryRateLimit: makeLimitHandler('secondary', 3),
    },
  });
  _octokitAuthToken = personalAccessToken;

  return _octokit;
}

// Helper function to make iterating through Octokit pagination easier.
// Pass in a pagination iterator, plus a function to convert one page to a list of results.
export async function * iterateIterator<T, U>(input: AsyncIterable<T>, fn: (_: T) => U[]) {
  for await (const list of input) {
    yield * fn(list);
  }
}

export type IssueOrPullRequest = Awaited<ReturnType<Octokit['rest']['search']['issuesAndPullRequests']>>['data']['items'][0];

/**
 * Represents the main Rancher Desktop repo (rancher-sandbox/rancher-desktop
 * as of the time of writing) or one of its forks.
 */
export class RancherDesktopRepository {
  owner: string;
  repo:  string;

  constructor(owner: string, repo: string) {
    this.owner = owner;
    this.repo = repo;
  }

  async createIssue(title: string, body: string, githubToken?: string): Promise<void> {
    const result = await getOctokit(githubToken).rest.issues.create({
      owner: this.owner, repo: this.repo, title, body,
    });
    const issue = result.data;

    console.log(`Created issue #${ issue.number }: "${ issue.title }"`);
  }

  async reopenIssue(issue: IssueOrPullRequest, githubToken?: string): Promise<void> {
    await getOctokit(githubToken).rest.issues.update({
      owner: this.owner, repo: this.repo, issue_number: issue.number, state: 'open',
    });
    console.log(`Reopened issue #${ issue.number }: "${ issue.title }"`);
  }

  async closeIssue(issue: IssueOrPullRequest, githubToken?: string): Promise<void> {
    await getOctokit(githubToken).rest.issues.update({
      owner: this.owner, repo: this.repo, issue_number: issue.number, state: 'closed',
    });
    console.log(`Closed issue #${ issue.number }: "${ issue.title }"`);
  }
}

/**
 * For a GitHub repository, get a list of published releases and return their
 * tags (including any `v` prefix).
 */
export async function getPublishedReleaseTagNames(owner: string, repo: string, releaseFilter: Exclude<ReleaseFilter, 'custom'> = 'semver', githubToken?: string): Promise<string[]> {
  const response = await getOctokit(githubToken).rest.repos.listReleases({ owner, repo });
  let releases = response.data;

  // Filter for non-draft releases
  releases = releases.filter(release => release.published_at !== null);

  // Filter out pre-releases
  if (releaseFilter !== 'published-pre') {
    releases = releases.filter(release => !release.prerelease);
  }
  let tagNames = releases.map(release => release.tag_name);

  if (releaseFilter === 'semver') {
    tagNames = tagNames.filter(tag => !semver.coerce(tag)?.prerelease?.length);
  }

  return tagNames;
}
