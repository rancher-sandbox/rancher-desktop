import { Octokit } from 'octokit';

import { LimaAndQemu, AlpineLimaISO } from 'scripts/dependencies/lima';
import * as tools from 'scripts/dependencies/tools';
import { WSLDistro, HostResolverHost } from 'scripts/dependencies/wsl';
import { Dependency, UnreleasedChangeMonitor, HasUnreleasedChangesResult, getOctokit } from 'scripts/lib/dependencies';

const GITHUB_OWNER = process.env.GITHUB_REPOSITORY?.split('/')[0] || 'rancher-sandbox';
const GITHUB_REPO = process.env.GITHUB_REPOSITORY?.split('/')[1] || 'rancher-desktop';
// a (hopefully) unique and communicative key that is used to find issues created by
// this script by filtering them down to the ones that have it in their title
const UCMONITOR = 'ucmonitor';

type UnreleasedChangeMonitoringDependency = Dependency & UnreleasedChangeMonitor;

type DependencyState = { dependency: UnreleasedChangeMonitoringDependency } & HasUnreleasedChangesResult;

const dependencies: UnreleasedChangeMonitoringDependency[] = [
  new LimaAndQemu(),
  new WSLDistro(),
  new tools.DockerCLI(),
  new tools.Steve(),
  new tools.GuestAgent(),
  new tools.RancherDashboard(),
  new AlpineLimaISO(),
  new HostResolverHost(), // we only need one of HostResolverHost and HostResolverPeer
];

type Issue = Awaited<ReturnType<Octokit['rest']['search']['issuesAndPullRequests']>>['data']['items'][0];

async function getExistingIssuesFor(dependencyName: string): Promise<Issue[]> {
  const queryString = `type:issue in:title repo:${ GITHUB_OWNER }/${ GITHUB_REPO } ${ UCMONITOR } ${ dependencyName } sort:updated`;
  const response = await getOctokit().rest.search.issuesAndPullRequests({ q: queryString });

  return response.data.items;
}

async function reopenIssue(issue: Issue): Promise<void> {
  await getOctokit().rest.issues.update({
    owner: GITHUB_OWNER, repo: GITHUB_REPO, issue_number: issue.number, state: 'open',
  });
  console.log(`Reopened issue #${ issue.number }: "${ issue.title }"`);
}

async function closeIssue(issue: Issue): Promise<void> {
  await getOctokit().rest.issues.update({
    owner: GITHUB_OWNER, repo: GITHUB_REPO, issue_number: issue.number, state: 'closed',
  });
  console.log(`Closed issue #${ issue.number }: "${ issue.title }"`);
}

async function createIssue(latestReleaseTag: string, dependency: UnreleasedChangeMonitoringDependency): Promise<void> {
  const title = `${ UCMONITOR }: ${ dependency.name } has changes since ${ latestReleaseTag }`;
  const body = `Unreleased Change Monitor has detected changes to ${ dependency.name } since its last release, ${ latestReleaseTag }.` +
    `\n\nThis is a reminder to release these changes so they make it into the next Rancher Desktop release.`;
  const response = await getOctokit().rest.issues.create({
    owner: GITHUB_OWNER, repo: GITHUB_REPO, title, body,
  });
  const issue = response.data;

  console.log(`Created issue #${ issue.number }: "${ issue.title }"`);
}

// Creates issues in the main Rancher Desktop repo for external
// depndencies that have changes that have not been released.
// Also closes issues that were previously created by this script,
// but that are no longer relevant.
async function checkForUnreleasedChanges(): Promise<void> {
  const dependencyStates: DependencyState[] = await Promise.all(dependencies.map(async(dependency) => {
    const result = await dependency.hasUnreleasedChanges();

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
          await reopenIssue(existingIssue);
        } else if (existingIssue.state === 'open' && issueTitleMatchesLatestReleaseTag) {
          // we have an issue that is open that we want to be open
          issueExists = true;
        } else if (existingIssue.state === 'open' && !issueTitleMatchesLatestReleaseTag) {
          // this is an open issue that does not match this release; close it
          await closeIssue(existingIssue);
        }
      }));
      if (!issueExists) {
        await createIssue(dependencyState.latestReleaseTag, dependency);
      }
    } else {
      await Promise.all(existingIssues.map(async(existingIssue) => {
        if (existingIssue.state === 'open') {
          // there should be no open issues; close this one
          await closeIssue(existingIssue);
        }
      }));
    }
  }));
}

checkForUnreleasedChanges().catch((e) => {
  console.error(e);
  process.exit(1);
});
