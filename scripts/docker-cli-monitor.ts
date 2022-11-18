import path from 'path';

import semver from 'semver';

import { readDependencyVersions, getOctokit, RancherDesktopRepository, IssueOrPullRequest } from 'scripts/lib/dependencies';

const GITHUB_OWNER = process.env.GITHUB_REPOSITORY?.split('/')[0] || 'rancher-sandbox';
const GITHUB_REPO = process.env.GITHUB_REPOSITORY?.split('/')[1] || 'rancher-desktop';
const DOCKER_CLI_OWNER = process.env.DOCKER_CLI_OWNER || 'docker';
const DOCKER_CLI_REPO = process.env.DOCKER_CLI_REPO || 'cli';
const TAG_REGEX = /^v[0-9]+\.[0-9]+\.[0-9]+$/;
const SCRIPT_NAME = 'docker-cli-monitor';
const mainRepo = new RancherDesktopRepository(GITHUB_OWNER, GITHUB_REPO);

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

async function getDockerCliIssues(): Promise<IssueOrPullRequest[]> {
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
        await mainRepo.reopenIssue(issue);
      }
    } else if (issue.state === 'open') {
      await mainRepo.closeIssue(issue);
    }
  }));
  if (!issueFound) {
    const title = `${ SCRIPT_NAME }: make rancher-desktop-docker-cli release for version ${ latestTagName }`;
    const body = `The Docker CLI monitor has detected a new release of docker/cli. ` +
      `Please make a corresponding release in rancher-desktop-docker-cli to keep it up to date in Rancher Desktop.`;

    await mainRepo.createIssue(title, body);
  }
}

checkDockerCli().catch((e) => {
  console.error(e);
  process.exit(1);
});
