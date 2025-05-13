import { Octokit } from 'octokit';

import { Lima, Qemu, AlpineLimaISO } from 'scripts/dependencies/lima';
import * as tools from 'scripts/dependencies/tools';
import { WSLDistro } from 'scripts/dependencies/wsl';
import { GitHubDependency, HasUnreleasedChangesResult, getOctokit, RancherDesktopRepository } from 'scripts/lib/dependencies';

const GITHUB_OWNER = process.env.GITHUB_REPOSITORY?.split('/')[0] || 'rancher-sandbox';
const GITHUB_REPO = process.env.GITHUB_REPOSITORY?.split('/')[1] || 'rancher-desktop';
// a (hopefully) unique and communicative key that is used to find issues created by
// this script by filtering them down to the ones that have it in their title
const UCMONITOR = 'ucmonitor';
const mainRepo = new RancherDesktopRepository(GITHUB_OWNER, GITHUB_REPO);

type DependencyState = { dependency: GitHubDependency } & HasUnreleasedChangesResult;

const dependencies: GitHubDependency[] = [
  new Lima(),
  new Qemu(),
  new WSLDistro(),
  new tools.DockerCLI(),
  new tools.Steve(),
  new tools.RancherDashboard(),
  new AlpineLimaISO(),
];

type Issue = Awaited<ReturnType<Octokit['rest']['search']['issuesAndPullRequests']>>['data']['items'][0];

async function getExistingIssuesFor(dependencyName: string): Promise<Issue[]> {
  const queryString = `type:issue in:title repo:${ GITHUB_OWNER }/${ GITHUB_REPO } ${ UCMONITOR } ${ dependencyName } sort:updated`;
  const response = await getOctokit().rest.search.issuesAndPullRequests({ q: queryString });

  return response.data.items;
}

/**
 * Tells the caller whether the given dependency has any
 * changes that have not been released.
 */
export async function hasUnreleasedChanges(dependency: GitHubDependency): Promise<HasUnreleasedChangesResult> {
  const latestVersion = await dependency.latestVersion;
  const latestTagName = dependency.versionToTagName(latestVersion);

  // Get the date of the commit that the tag points to.
  // We can't use the publish date of the release, because that
  // omits commits that were made after the commit that was tagged
  // for the release, but before the actual release.
  const result = await getOctokit().rest.repos.getCommit({
    owner: dependency.githubOwner, repo: dependency.githubRepo, ref: latestTagName,
  });
  const dateOfTaggedCommit = result.data.commit.committer?.date;

  const response = await getOctokit().rest.repos.listCommits({
    owner: dependency.githubOwner, repo: dependency.githubRepo, since: dateOfTaggedCommit,
  });
  const commits = response.data;

  console.log(`Found ${ commits.length - 1 } unreleased commits ` +
              `for repository ${ dependency.githubOwner }/${ dependency.githubRepo } ` +
              `since ${ JSON.stringify(latestVersion) } (${ latestTagName }).`);

  return {
    latestReleaseTag:     latestTagName,
    hasUnreleasedChanges: commits.length > 1,
  };
}

// Creates issues in the main Rancher Desktop repo for external
// dependencies that have changes that have not been released.
// Also closes issues that were previously created by this script,
// but that are no longer relevant.
async function checkForUnreleasedChanges(): Promise<void> {
  const dependencyStates: DependencyState[] = await Promise.all(dependencies.map(async(dependency) => {
    const result = await hasUnreleasedChanges(dependency);

    return { ...result, dependency };
  }));

  // reconcile issues with dependency states
  await Promise.all(dependencyStates.map(async(dependencyState) => {
    const dependency = dependencyState.dependency;

    // get issues that are relevant to this specific dependency
    const existingIssues = await getExistingIssuesFor(dependency.name);

    if (dependencyState.hasUnreleasedChanges) {
      let issueExists = false;

      await Promise.all(existingIssues.map(async(existingIssue) => {
        const issueTitleMatchesLatestReleaseTag = existingIssue.title.endsWith(` ${ dependencyState.latestReleaseTag }`);

        if (existingIssue.state === 'closed' && issueTitleMatchesLatestReleaseTag) {
          // issue is closed, but it is the same as the one we would create; open it
          issueExists = true;
          await mainRepo.reopenIssue(existingIssue);
        } else if (existingIssue.state === 'open' && issueTitleMatchesLatestReleaseTag) {
          // we have an issue that is open that we want to be open
          issueExists = true;
        } else if (existingIssue.state === 'open' && !issueTitleMatchesLatestReleaseTag) {
          // this is an open issue that does not match this release; close it
          await mainRepo.closeIssue(existingIssue);
        }
      }));
      if (!issueExists) {
        const title = `${ UCMONITOR }: ${ dependency.name } has changes since ${ dependencyState.latestReleaseTag }`;
        const body = `Unreleased Change Monitor has detected changes to ${ dependency.name } since its last release, ${ dependencyState.latestReleaseTag }.` +
          `\n\nThis is a reminder to release these changes so they make it into the next Rancher Desktop release.`;

        await mainRepo.createIssue(title, body);
      }
    } else {
      await Promise.all(existingIssues.map(async(existingIssue) => {
        if (existingIssue.state === 'open') {
          // there should be no open issues; close this one
          await mainRepo.closeIssue(existingIssue);
        }
      }));
    }
  }));
}

checkForUnreleasedChanges().catch((e) => {
  console.error(e);
  process.exit(1);
});
