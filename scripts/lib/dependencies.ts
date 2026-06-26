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
export type GoArch = 'amd64' | 'arm64';

/**
 * The platform axis an {@link DependencyAsset} targets: the Go platform name,
 * plus `wsl` for the WSL-specific build (the only place where a single
 * architecture ships distinct linux and WSL binaries).
 */
export type AssetPlatform = GoPlatform | 'wsl';

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
  electron:                        string;
  'golangci-lint':                 string;
  trivy:                           string;
  steve:                           string;
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
 * One downloadable artifact for a dependency.  Every field needed to fetch and
 * verify the bytes lives here, so a downloader needs no per-package knowledge.
 * It selects by {@link platform}/{@link arch} (and {@link variant} where one
 * package ships several), fetches {@link url}, and checks the bytes against
 * {@link checksum}.
 */
export interface DependencyAsset {
  /** The platform this artifact targets. */
  platform: AssetPlatform;
  /**
   * The architecture this artifact targets.  Omitted for arch-independent
   * artifacts (e.g. the WiX .NET toolset), which match any architecture.
   */
  arch?:    GoArch;
  /** The fully-resolved download URL. */
  url:      string;
  /** The sha256 of the downloaded bytes, `sha256:`-prefixed. */
  checksum: Sha256Checksum;
  /**
   * Distinguishes artifacts that share a platform/arch but differ in kind,
   * such as a Helm chart versus its CRDs.
   */
  variant?: string;
}

/**
 * The entry recorded for each dependency in a `dependencies.yaml`: the tracked
 * version plus the {@link DependencyAsset}s resolved for it.  The shape mirrors
 * the on-disk YAML so the in-memory model and the file stay in sync without
 * translation.
 */
export interface DependencyEntry {
  version: Version;
  assets:  DependencyAsset[];
}

/** The parsed contents of a `dependencies.yaml`, keyed by dependency name. */
export type DependencyManifest = Record<string, DependencyEntry>;

interface RawAsset {
  platform: unknown;
  arch?:    unknown;
  url:      unknown;
  checksum: unknown;
  variant?: unknown;
}

interface RawEntry {
  version: unknown;
  assets?: unknown;
}

const ASSET_PLATFORMS = ['linux', 'darwin', 'windows', 'wsl'] satisfies readonly AssetPlatform[];
const ASSET_ARCHES = ['amd64', 'arm64'] satisfies readonly GoArch[];

/** Parses and validates a single asset from a manifest entry. */
function parseAsset(name: string, path: string, raw: RawAsset): DependencyAsset {
  if (!ASSET_PLATFORMS.includes(raw.platform as AssetPlatform)) {
    throw new Error(`Asset for ${ name } in ${ path } has invalid platform ${ JSON.stringify(raw.platform) }`);
  }
  if (raw.arch !== undefined && !ASSET_ARCHES.includes(raw.arch as GoArch)) {
    throw new Error(`Asset for ${ name } in ${ path } has invalid arch ${ JSON.stringify(raw.arch) }`);
  }
  if (typeof raw.url !== 'string' || !URL.canParse(raw.url)) {
    throw new Error(`Asset for ${ name } in ${ path } has invalid url ${ JSON.stringify(raw.url) }`);
  }
  const asset: DependencyAsset = {
    platform: raw.platform as AssetPlatform,
    url:      raw.url,
    checksum: parseSha256Checksum(raw.checksum),
  };

  if (raw.arch !== undefined) {
    asset.arch = raw.arch as GoArch;
  }
  if (raw.variant !== undefined) {
    if (typeof raw.variant !== 'string') {
      throw new Error(`Asset for ${ name } in ${ path } has invalid variant ${ JSON.stringify(raw.variant) }`);
    }
    asset.variant = raw.variant;
  }

  return asset;
}

/**
 * Validates a manifest entry's `version`.  Most dependencies track a plain
 * version string; `alpineLimaISO` and `mobyOpenAPISpec` track a structured
 * version (see {@link AlpineLimaISOVersion} / {@link MobyOpenAPISpecVersion}),
 * so those two shapes are accepted too.  A bare YAML number (e.g. `1.0`) is
 * rejected so an unquoted version cannot silently lose precision.  The
 * `mobyOpenAPISpec` commit must be a full 40-char SHA.  A mutable ref (a
 * branch, a short SHA) would otherwise let a regenerate bake a moving target
 * into the install URL, defeating the immutable-source guarantee.
 */
function parseVersion(name: string, path: string, raw: unknown): Version {
  if (typeof raw === 'string') {
    return raw;
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;

    if (typeof obj.isoVersion === 'string' && typeof obj.alpineVersion === 'string') {
      return { isoVersion: obj.isoVersion, alpineVersion: obj.alpineVersion };
    }
    if (typeof obj.apiVersion === 'string' && typeof obj.commit === 'string') {
      if (!/^[0-9a-f]{40}$/i.test(obj.commit)) {
        throw new Error(`Entry ${ name } in ${ path } has invalid mobyOpenAPISpec commit ${ JSON.stringify(obj.commit) }; expected a 40-char SHA`);
      }

      return { apiVersion: obj.apiVersion, commit: obj.commit };
    }
  }

  throw new Error(`Entry ${ name } in ${ path } has invalid version ${ JSON.stringify(raw) }; expected a string or a structured version`);
}

/**
 * Reads a `dependencies.yaml` into the typed manifest.  An entry with no
 * `assets` list parses with an empty one, so `rddepman --regenerate` can
 * migrate a manifest still written in the old `checksums` schema.  Remove
 * the tolerance, and its test, once this change has landed on `main`.
 */
export async function readDependencyManifest(path: string): Promise<DependencyManifest> {
  const raw: Record<string, RawEntry> = YAML.parse(await fs.promises.readFile(path, 'utf-8'));
  const manifest: DependencyManifest = {};

  for (const [name, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== 'object' || !('version' in entry)) {
      throw new Error(`Entry ${ name } in ${ path } is missing a "version" field`);
    }
    if (entry.assets !== undefined && !Array.isArray(entry.assets)) {
      throw new Error(`Entry ${ name } in ${ path } has a non-list "assets" field`);
    }
    manifest[name] = {
      version: parseVersion(name, path, entry.version),
      assets:  ((entry.assets as RawAsset[]) ?? []).map(asset => parseAsset(name, path, asset)),
    };
  }

  return manifest;
}

// Split the editor-warning marker across array entries so this source file
// itself stays unflagged; the joined output reassembles it for editors that
// scan the YAML.
const MANIFEST_HEADER = [
  '# Regenerated by `yarn rddepman` on every dependency bump.  DO NOT ',
  'EDIT.\n',
  '# Manual edits must recompute the affected sha256 entries; stale digests\n',
  '# fail verification at download time.  Document non-obvious version pins in\n',
  '# scripts/dependencies/<name>.ts instead of inline comments here — the\n',
  '# next bump will strip them.\n',
  '#\n',
  '# Each entry pairs a version with the assets resolved for it; every asset\n',
  '# carries its full url and sha256 so a downloader can fetch and verify it\n',
  '# without per-package knowledge.\n',
].join('');

/**
 * Caches each manifest read by path so the dependency classes that share a
 * file read it once.  {@link writeDependencyManifest} invalidates the entry
 * for the file it wrote.
 */
const manifestCache = new Map<string, Promise<DependencyManifest>>();

/** Reads a manifest through {@link manifestCache}. */
function getCachedManifest(path: string): Promise<DependencyManifest> {
  let cached = manifestCache.get(path);

  if (!cached) {
    cached = readDependencyManifest(path);
    manifestCache.set(path, cached);
  }

  return cached;
}

/**
 * Renders an asset with a fixed key order (selector fields, then url and
 * checksum), omitting absent optional fields.  Keeps the emitted YAML
 * deterministic regardless of how the asset object was built.
 */
function serializeAsset(asset: DependencyAsset): Record<string, unknown> {
  const out: Record<string, unknown> = { platform: asset.platform };

  if (asset.arch !== undefined) {
    out.arch = asset.arch;
  }
  if (asset.variant !== undefined) {
    out.variant = asset.variant;
  }
  out.url = asset.url;
  out.checksum = asset.checksum;

  return out;
}

/**
 * Writes the manifest to disk and invalidates the cached read for that path so
 * subsequent reads observe the new contents.  Always emits a leading header
 * comment so contributors editing the YAML directly see the warning where they
 * are editing; everything else round-trips through `YAML.stringify`, which
 * drops any other comments on the next rddepman bump.
 */
export async function writeDependencyManifest(path: string, manifest: DependencyManifest): Promise<void> {
  const serializable = Object.fromEntries(Object.entries(manifest).map(([name, entry]) => [name, {
    version: entry.version,
    assets:  entry.assets.map(serializeAsset),
  }]));

  manifestCache.delete(path);
  await fs.promises.writeFile(path, MANIFEST_HEADER + YAML.stringify(serializable), { encoding: 'utf-8' });
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

/** A predicate over a dependency's assets used to pick the one(s) to install. */
export interface AssetSelector {
  platform: AssetPlatform;
  arch?:    GoArch;
  variant?: string;
}

/** Returns whether `asset` matches `selector`. */
function assetMatches(asset: DependencyAsset, selector: AssetSelector): boolean {
  return asset.platform === selector.platform &&
    (selector.arch === undefined || asset.arch === undefined || asset.arch === selector.arch) &&
    (selector.variant === undefined || asset.variant === selector.variant);
}

/** Renders a selector for error messages. */
function describeSelector(selector: AssetSelector): string {
  return Object.entries(selector).map(([key, value]) => `${ key }=${ value }`).join(', ');
}

/**
 * Returns every asset of dependency `name` matching `selector`.  Throws if the
 * dependency is absent from the manifest.
 */
export function selectAssets(context: DownloadContext, name: string, selector: AssetSelector): DependencyAsset[] {
  const entry = context.dependencies[name];

  if (!entry) {
    throw new Error(`Dependency "${ name }" is not present in the dependency manifest.`);
  }

  return entry.assets.filter(asset => assetMatches(asset, selector));
}

/**
 * Returns the single asset of dependency `name` matching `selector`.  Throws
 * unless exactly one asset matches.
 */
export function selectAsset(context: DownloadContext, name: string, selector: AssetSelector): DependencyAsset {
  const matches = selectAssets(context, name, selector);

  if (matches.length !== 1) {
    const urls = matches.map(asset => asset.url).join(', ') || '(none)';

    throw new Error(
      `Expected exactly one ${ name } asset for ${ describeSelector(selector) }, found ${ matches.length }: ${ urls }.`,
    );
  }

  return matches[0];
}

/** Returns an asset's checksum as raw hex, ready for `download()`. */
export function assetChecksum(asset: DependencyAsset): string {
  return asset.checksum.slice('sha256:'.length);
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

  /** The assets recorded for the current version; empty when none are tracked. */
  get currentAssets(): Promise<DependencyAsset[]> {
    return Promise.resolve([]);
  }

  /**
   * Whether `rddepman --regenerate` re-resolves this dependency's assets at its
   * recorded version.  Defaults to true; a dependency opts out when its assets
   * cannot be resolved from the recorded version alone.
   */
  readonly regenerable: boolean = true;

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
   * Resolves every {@link DependencyAsset} for the given version, verifying
   * each against any upstream checksum file the source publishes.  rddepman
   * calls this at bump time and records the result in the manifest.  Classes
   * that download nothing (e.g. `check-spelling`) return an empty list.
   */
  abstract getAssets(version: Version): Promise<DependencyAsset[]>;

  /**
   * Update the version manifest (e.g. `dependencies.yaml`) for this dependency,
   * in preparation for making a pull request.
   * @returns The set of files that have been modified.
   */
  abstract updateManifest(newVersion: Version, newAssets: DependencyAsset[]): Promise<Set<string>>;

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

/**
 * A GlobalDependency is a dependency whose version and assets are managed in a
 * `dependencies.yaml` manifest.  {@link GlobalDependency.manifestPath} selects
 * which one; it defaults to {@link DEP_VERSIONS_PATH}, and a subclass may
 * override it to track a separate manifest.
 */
export function GlobalDependency<T extends abstract new(...args: any[]) => VersionedDependency>(Base: T) {
  abstract class GlobalDependency extends Base {
    /** The dependency's name, a top-level key in the manifest at {@link manifestPath}. */
    abstract name: string;

    /** The manifest file this dependency's version and assets live in. */
    readonly manifestPath: string = DEP_VERSIONS_PATH;

    get currentVersion(): Promise<Version> {
      return getCachedManifest(this.manifestPath).then(m => m[this.name].version);
    }

    get currentAssets(): Promise<DependencyAsset[]> {
      return getCachedManifest(this.manifestPath).then(m => m[this.name].assets);
    }

    async updateManifest(newVersion: Version, newAssets: DependencyAsset[]): Promise<Set<string>> {
      const manifest = await getCachedManifest(this.manifestPath);

      manifest[this.name] = { version: newVersion, assets: newAssets };
      await writeDependencyManifest(this.manifestPath, manifest);

      return new Set([this.manifestPath]);
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
