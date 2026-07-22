/**
 * rddepman - manage the versions of Rancher Desktop's external dependencies.
 *
 *   yarn rddepman [<config>] [--regenerate]
 *
 * Checks every dependency in <config> (default `host`) for a newer upstream
 * release and opens one pull request per bump, recording the new version and
 * the assets resolved for it.  Bumping needs a GITHUB_TOKEN.
 *
 * With --regenerate, re-resolves the assets of every dependency at its recorded
 * version and rewrites the manifest in place, opening no pull requests.  Run it
 * after changing how a dependency resolves its assets; regenerating needs only
 * network access.
 *
 * Setting RD_DEPMAN_LOCAL_CHANGES leaves the bumped manifest in the working
 * tree instead of opening pull requests, to test the workflow locally.
 */

import { spawnSync } from 'child_process';

import { Octokit } from 'octokit';
import semver from 'semver';

import { getExtensions } from './lib/extension-data';

import { globalDependencies } from '@/scripts/dependencies/global';
import {
  getOctokit,
  iterateIterator,
  GitHubDependency,
  Version,
  VersionedDependency,
} from '@/scripts/lib/dependencies';

const MAIN_BRANCH = 'main';
const GITHUB_OWNER = process.env.GITHUB_REPOSITORY?.split('/')[0] || 'rancher-sandbox';
const GITHUB_REPO = process.env.GITHUB_REPOSITORY?.split('/')[1] || 'rancher-desktop';
/** If set, update the manifest without creating pull requests, for testing the workflow. */
const SKIP_PULL_REQUESTS = !!process.env.RD_DEPMAN_LOCAL_CHANGES;

interface VersionComparison {
  dependency:     VersionedDependency;
  currentVersion: Version;
  latestVersion:  Version;
}

/**
 * A named set of dependencies rddepman manages together.  CI runs rddepman once
 * per config.  `manifest` holds the dependencies recorded in one
 * `dependencies.yaml`, whose assets `--regenerate` rewrites; `extras` are other
 * tracked dependencies (e.g. marketplace extensions) recorded elsewhere.
 */
interface DependencyConfig {
  manifest: VersionedDependency[];
  extras:   () => VersionedDependency[];
}

const configs: Record<string, DependencyConfig> = {
  host: { manifest: globalDependencies, extras: () => getExtensions(true) },
};

/**
 * Run a git command line.  If the first argument is `true`, return the exit
 * code.  Otherwise, throw an error if the command did not exit with `0`.
 */
function git(...args: string[]): 0 | null;
function git(returnStatus: true, ...args: string[]): number | null;
function git(returnOrArg: string | true, ...args: string[]): number | null {
  const name = 'Rancher Desktop Dependency Manager';
  const email = 'donotuse@rancherdesktop.io';

  if (typeof returnOrArg === 'string') {
    args.unshift(returnOrArg);
  }

  const result = spawnSync('git', args, {
    stdio: 'inherit',
    env:   {
      ...process.env,
      GIT_AUTHOR_NAME:     name,
      GIT_AUTHOR_EMAIL:    email,
      GIT_COMMITTER_NAME:  name,
      GIT_COMMITTER_EMAIL: email,
    },
  });

  if (result.error) {
    throw result.error;
  }

  if (returnOrArg !== true && result.status) {
    throw `git returned error code ${ result.status }`;
  }

  return result.status;
}

function printable(version: Version): string {
  return VersionedDependency.versionString(version);
}

function getBranchName(name: string, currentVersion: Version, latestVersion: Version): string {
  return `rddepman/${ name }/${ printable(currentVersion) }-to-${ printable(latestVersion) }`;
}

function getTitle(name: string, currentVersion: Version, latestVersion: Version): string {
  return `rddepman: bump ${ name } from ${ printable(currentVersion) } to ${ printable(latestVersion) }`;
}

async function getBody(dependency: VersionedDependency, currentVersion: Version, latestVersion: Version): Promise<string> {
  if (!(dependency instanceof GitHubDependency) || typeof currentVersion !== 'string' || typeof latestVersion !== 'string') {
    // If the dependency is not on GitHub, we don't have any additional information yet.
    return '';
  }
  const currentSemver = semver.parse(currentVersion, true);
  const latestSemver = semver.parse(latestVersion, true);
  const { githubOwner: owner, githubRepo: repo } = dependency;

  if (!currentSemver || !latestSemver) {
    console.log(`Can't parse ${ dependency.name } current or latest version ${ currentVersion } / ${ latestVersion }`);

    return '';
  }

  type releaseType = Awaited<ReturnType<Octokit['rest']['repos']['listReleases']>>['data'][number];
  const releaseIterator = getOctokit().paginate.iterator(
    getOctokit().rest.repos.listReleases,
    { owner, repo });
  const releaseNotes: [semver.SemVer, releaseType][] = [];

  for await (const release of iterateIterator(releaseIterator, r => r.data)) {
    const version = semver.parse(release.tag_name, true);

    if (!version) {
      if (release.tag_name === dependency.versionToTagName(currentVersion)) {
        // Version cannot be parsed, but it's the current version.
        break;
      }
      console.log(`Ignoring non-semver ${ dependency.name } version ${ release.tag_name }`);
      continue;
    }
    if (semver.eq(version, currentSemver)) {
      // Found the current version, don't look at anything older.
      break;
    }
    if (semver.lt(version, currentSemver)) {
      // Found a patch release of the previous version, or similar.
      continue;
    }
    if (semver.gt(version, latestSemver)) {
      // Found a version after the latest version (alpha or similar).
      continue;
    }
    if (version.prerelease.length && !latestSemver.prerelease.length) {
      // This is a pre-release, but the release we're picking is not a pre-release.
      continue;
    }
    releaseNotes.push([version, release]);
  }

  releaseNotes.sort(([a], [b]) => semver.compare(a, b));
  let lastVersion = dependency.versionToTagName(currentVersion);

  return releaseNotes.map(([, release]) => {
    const body = release.body?.replace(/(?<!\w)(#\d+)\b/g, (n) => `${ owner }/${ repo }${ n }`) || `Release ${ release.name } does not have release notes.`;
    const compareLink = [
      `[Compare between ${ lastVersion } and ${ release.tag_name }]`,
      `(https://github.com/${ owner }/${ repo }/compare/${ lastVersion }...${ release.tag_name })`,
    ].join('');

    lastVersion = release.tag_name;
    if (releaseNotes.length > 1) {
      // Make sure we don't have leading spaces or this turns into <pre>.
      return [
        '<details>',
        `<summary><h3>${ release.name } (${ release.tag_name })</h3></summary>`,
        '',
        body,
        '</details>',
        '',
        compareLink,
      ].join('\n');
    }

    return `## ${ release.name } (${ release.tag_name })\n${ body }\n${ compareLink }\n`;
  }).join('\n');
}

async function createDependencyBumpPR(dependency: VersionedDependency, currentVersion: Version, latestVersion: Version): Promise<void> {
  const title = getTitle(dependency.name, currentVersion, latestVersion);
  const branchName = getBranchName(dependency.name, currentVersion, latestVersion);

  console.log(`Creating PR "${ title }".`);
  try {
    await getOctokit().rest.pulls.create({
      owner: GITHUB_OWNER,
      repo:  GITHUB_REPO,
      title,
      body:  await getBody(dependency, currentVersion, latestVersion),
      base:  MAIN_BRANCH,
      head:  branchName,
    });
  } catch (err: any) {
    console.log(JSON.stringify(err.response?.data, undefined, 2));
    throw err;
  }
}

type PRSearchFn = ReturnType<Octokit['rest']['search']['issuesAndPullRequests']>;

async function getPulls(name: string): Promise<Awaited<PRSearchFn>['data']['items']> {
  const queryString = `type:pr repo:${ GITHUB_OWNER }/${ GITHUB_REPO } head:rddepman/${ name } sort:updated`;
  const pullsIterator = getOctokit().paginate.iterator(
    getOctokit().rest.search.issuesAndPullRequests,
    { q: queryString });
  const results: Awaited<PRSearchFn>['data']['items'] = [];

  for await (const item of iterateIterator(pullsIterator, p => p.data)) {
    if (!item.pull_request) {
      continue;
    }
    const { data: pr } = await getOctokit().rest.pulls.get({
      owner: GITHUB_OWNER, repo: GITHUB_REPO, pull_number: item.number,
    });

    if (pr.head.repo && pr.head.repo.full_name !== `${ GITHUB_OWNER }/${ GITHUB_REPO }`) {
      // Ignore cross-repo PRs; they're not automatically generated.
      continue;
    }
    results.push(item);
  }

  return results;
}

async function determineUpdatesAvailable(dependencies: VersionedDependency[]): Promise<VersionComparison[]> {
  const results = await Promise.all(dependencies.map(async dependency => ({
    dependency,
    currentVersion: await dependency.currentVersion,
    latestVersion:  await dependency.latestVersion,
    canUpgrade:     await dependency.canUpgrade,
  })));

  for (const {
    dependency, currentVersion, latestVersion, canUpgrade,
  } of results) {
    if (!canUpgrade) {
      console.log(`${ dependency.name } is up to date (${ JSON.stringify(currentVersion) }).`);
      continue;
    }

    console.log(`Can update ${ dependency.name } from ${ JSON.stringify(currentVersion) } to ${ JSON.stringify(latestVersion) }`);
  }

  return results.filter(x => x.canUpgrade);
}

async function checkDependencies(dependencies: VersionedDependency[]): Promise<void> {
  // exit if there are unstaged changes
  git('update-index', '--refresh');
  if (git(true, 'diff-index', '--quiet', 'HEAD', '--')) {
    console.log('You have unstaged changes. Commit or stash them to manage dependencies.');

    return;
  }

  if (process.env.CI) {
    // When in CI, make sure we compare against the main branch.
    git('switch', '--force-create', 'main', 'origin/main');
  }

  const updatesAvailable = await determineUpdatesAvailable(dependencies);

  if (!process.env.CI) {
    // When not running in CI, don't try to make pull requests.

    if (SKIP_PULL_REQUESTS) {
      console.log('Forcing local changes without pull requests');
      for (const { dependency, latestVersion } of updatesAvailable) {
        const newAssets = await dependency.getAssets(latestVersion);
        await dependency.updateManifest(latestVersion, newAssets);
      }
    }
    if (updatesAvailable.length) {
      console.log(`Not running in CI, skipping creation of ${ updatesAvailable.length } pull requests.`);
    }

    return;
  }

  // reconcile dependencies that need an update with state of repo's PRs
  const needToCreatePR: VersionComparison[] = [];

  await Promise.all(updatesAvailable.map(async({ dependency, currentVersion, latestVersion }) => {
    // try to find PR for this combo of name, current version and latest version
    const prs = await getPulls(dependency.name);

    // we use title, rather than branch name, to filter pull requests
    // because branch name is not available from the search endpoint
    const title = getTitle(dependency.name, currentVersion, latestVersion);
    let prExists = false;

    await Promise.all(prs.map(async(pr) => {
      if (pr.title !== title && pr.state === 'open') {
        console.log(`Closing stale PR "${ pr.title }" (#${ pr.number }).`);
        await getOctokit().rest.pulls.update({
          owner: GITHUB_OWNER, repo: GITHUB_REPO, pull_number: pr.number, state: 'closed',
        });
      } else if (pr.title === title) {
        console.log(`Found existing PR "${ title }" (#${ pr.number }).`);
        prExists = true;
      }
    }));
    if (!prExists) {
      console.log(`Could not find PR "${ title }". Will create.`);
      needToCreatePR.push({
        dependency, currentVersion, latestVersion,
      });
    }
  }));

  // create a branch for each version update, make changes, and make a PR from the branch
  for (const { dependency, currentVersion, latestVersion } of needToCreatePR) {
    const branchName = getBranchName(dependency.name, currentVersion, latestVersion);
    const commitMessage = `Bump ${ dependency.name } from ${ printable(currentVersion) } to ${ printable(latestVersion) }`;

    // Resolve assets before branching so that an upstream verification
    // failure aborts the bump before any git state changes.
    console.log(`Resolving assets for ${ dependency.name } ${ printable(latestVersion) }...`);
    const newAssets = await dependency.getAssets(latestVersion);

    git('checkout', '-b', branchName, MAIN_BRANCH);
    git('add', ...await dependency.updateManifest(latestVersion, newAssets));
    git('commit', '--signoff', '--message', commitMessage);
    git('push', '--force', `https://${ process.env.GITHUB_TOKEN }@github.com/${ GITHUB_OWNER }/${ GITHUB_REPO }`);
    await createDependencyBumpPR(dependency, currentVersion, latestVersion);
  }
}

/**
 * Re-resolves and rewrites the assets for every manifest dependency at its
 * current version.  Migrates or refreshes a `dependencies.yaml` without a
 * version bump; needs no GitHub token, only network access to the artifacts.
 */
async function regenerateAssets(dependencies: VersionedDependency[]): Promise<void> {
  // A write rewrites the whole manifest, so regenerating the first dependency
  // would persist an empty asset list for a skipped one.  Check them up front.
  for (const dependency of dependencies.filter(d => !d.regenerable)) {
    if ((await dependency.currentAssets).length === 0) {
      throw new Error(
        `${ dependency.name } records no assets, and is bumped rather than regenerated. ` +
        `Restore its manifest entry before regenerating.`,
      );
    }
  }

  for (const dependency of dependencies) {
    if (!dependency.regenerable) {
      console.log(`Skipping ${ dependency.name } (bumped by rddepman, not regenerated).`);
      continue;
    }
    const version = await dependency.currentVersion;

    console.log(`Resolving assets for ${ dependency.name } ${ printable(version) }...`);
    const assets = await dependency.getAssets(version);

    await dependency.updateManifest(version, assets);
  }
}

/** Selects the config (positional argument, default `host`) and mode. */
function parseArgs(): { config: DependencyConfig, regenerate: boolean } {
  const args = process.argv.slice(2);
  const regenerate = args.includes('--regenerate');
  const name = args.find(arg => !arg.startsWith('--')) ?? 'host';
  const config = configs[name];

  if (!config) {
    throw new Error(`Unknown dependency config "${ name }"; expected one of ${ Object.keys(configs).join(', ') }.`);
  }

  return { config, regenerate };
}

(async() => {
  const { config, regenerate } = parseArgs();

  if (regenerate) {
    await regenerateAssets(config.manifest);
  } else {
    await checkDependencies([...config.manifest, ...config.extras()]);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
