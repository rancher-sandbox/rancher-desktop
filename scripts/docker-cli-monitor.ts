import path from 'path';

import { Octokit } from 'octokit';
import { readDependencyVersions, getOctokit } from 'scripts/lib/dependencies';
import semver from 'semver';

const GITHUB_OWNER = process.env.GITHUB_REPOSITORY?.split('/')[0] || 'rancher-sandbox';
const GITHUB_REPO = process.env.GITHUB_REPOSITORY?.split('/')[1] || 'rancher-desktop';
const DOCKER_CLI_OWNER = process.env.DOCKER_CLI_OWNER || 'docker';
const DOCKER_CLI_REPO = process.env.DOCKER_CLI_REPO || 'cli';
const TAG_REGEX = /^v[0-9]+\.[0-9]+\.[0-9]+$/;
const SCRIPT_NAME = 'docker-cli-monitor';

type Issue = Awaited<ReturnType<Octokit['rest']['search']['issuesAndPullRequests']>>['data']['items'][0];

async function getLatestDockerCliVersion(): Promise<string> {
  const result = await getOctokit().rest.repos.listTags({
    owner: DOCKER_CLI_OWNER, repo: DOCKER_CLI_REPO, per_page: 100,
  });
  const tags = result.data;
  const fullReleaseTags = tags.filter(tag => TAG_REGEX.test(tag.name));

  if (fullReleaseTags.length === 0) {
    throw new Error('Failed to find any valid tags');
  }
  fullReleaseTags.sort((previous, current) => {
    const previousWithoutV = previous.name.replace('v', '');
    const currentWithoutV = current.name.replace('v', '');

    return semver.rcompare(previousWithoutV, currentWithoutV, { loose: true });
  });
  const latestTag = fullReleaseTags[0];

  return latestTag.name;
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

async function createIssue(latestTagName: string): Promise<void> {
  const title = `${ SCRIPT_NAME }: make rancher-desktop-docker-cli release for version ${ latestTagName }`;
  const body = `The Docker CLI monitor has detected a new release of docker/cli.
Please make a corresponding release in rancher-desktop-docker-cli to keep it up to date in Rancher Desktop.`;
  const result = await getOctokit().rest.issues.create({
    owner: GITHUB_OWNER, repo: GITHUB_REPO, title, body,
  });
  const issue = result.data;

  console.log(`Created issue #${ issue.number }: "${ issue.title }"`);
}

async function getDockerCliIssues(): Promise<Issue[]> {
  const query = `type:issue repo:${ GITHUB_OWNER }/${ GITHUB_REPO } sort:updated in:title ${ SCRIPT_NAME }`;
  const result = await getOctokit().rest.search.issuesAndPullRequests({ q: query });

  return result.data.items;
}

async function checkDockerCli(): Promise<void> {
  const latestTagName = await getLatestDockerCliVersion();
  const latestVersion = latestTagName.replace('v', '');

  console.log(`Latest version: ${ latestVersion }`);

  const depVersionsPath = path.join('pkg', 'rancher-desktop', 'assets', 'dependencies.yaml');
  const dependencyVersions = await readDependencyVersions(depVersionsPath);

  console.log(`Current version: ${ dependencyVersions.dockerCLI }`);

  if (latestVersion === dependencyVersions.dockerCLI) {
    return;
  }

  const issues = await getDockerCliIssues();
  let issueFound = false;

  await Promise.all(issues.map(async(issue) => {
    if (issue.title.endsWith(` ${ latestTagName }`)) {
      issueFound = true;
      if (issue.state === 'closed') {
        await reopenIssue(issue);
      }
    } else if (issue.state === 'open') {
      await closeIssue(issue);
    }
  }));
  if (!issueFound) {
    await createIssue(latestTagName);
  }
}

checkDockerCli().catch((e) => {
  console.error(e);
  process.exit(1);
});
