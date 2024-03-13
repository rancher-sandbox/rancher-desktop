// This file creates PRs when releases are published to merge back to the main
// branch.

// Environment:
//   GITHUB_REPOSITORY, GITHUB_EVENT_PATH, and others
//     See https://docs.github.com/en/actions/learn-github-actions/variables#default-environment-variables
//   GITHUB_TOKEN: GitHub authorization token.

import fs from 'fs';

import { getOctokit } from './lib/dependencies';

/**
 * Valid value for an environment variable.
 */
type EnvironmentVariableName =
  'GITHUB_REPOSITORY' |
  'GITHUB_EVENT_PATH' |
  'GITHUB_TOKEN';

/**
 * Partial contents of the event payload, for a release event.
 */
interface GitHubReleasePayload {
  release: {
    tag_name: string;
  }
}

/**
 * The name of the branch to merge into.
 */
const base = 'main';

/**
 * Read the environment variable, or throw an error.
 * @param variable The environment variable to look up.
 * @returns The environment variable value.
 */
function getEnv(variable: EnvironmentVariableName): string {
  const result = process.env[variable];

  if (typeof result !== 'string') {
    throw new ReferenceError(`Environment variable ${ variable } is not set`);
  }

  return result;
}

/**
 * Determine the branch name from the tag.
 * @param owner The repository owner.
 * @param repo The repository name, excluding owner.
 * @param tagName The tag of the release event.
 * @returns The name of the branch to merge into the base branch.
 */
async function getBranch(owner: string, repo: string, tagName: string): Promise<string> {
  const [, release] = /^v(\d+\.\d+)\.\d+/.exec(tagName) ?? [];

  if (!release) {
    throw new TypeError(`Failed to guess branch name from tag "${ tagName }"`);
  }
  const branch = `release-${ release }`;
  const { data: ref } = await getOctokit().rest.git.getRef({
    owner, repo, ref: `heads/${ branch }`,
  });

  if (!ref.object.sha) {
    throw new TypeError(`Failed to get commit hash of branch "${ branch }"`);
  }

  return branch;
}

/**
 * Locate an existing pull request.
 * @param owner The repository owner.
 * @param repo The repository name (without the owner).
 * @param branch The branch to merge from (i.e. the release branch).
 * @returns The found pull request, or undefined.
 */
async function findExisting(owner: string, repo: string, branch: string) {
  const fullRepo = `${ owner }/${ repo }`;
  const query = `type:pr is:open repo:${ fullRepo } base:${ base } head:${ branch } sort:updated`;
  const result = await getOctokit().rest.search.issuesAndPullRequests({ q: query });

  for (const item of result.data.items) {
    // Must be an open item, and that item must be a pull request.
    if (item.state !== 'open' || !item.pull_request) {
      continue;
    }
    const { data: pr } = await getOctokit().rest.pulls.get({
      owner, repo, pull_number: item.number,
    });

    // PR target must be the expected repository.
    if (pr.base.repo.full_name !== fullRepo) {
      console.log(`Skipping ${ item.number }: incorrect base repo ${ pr.base.repo.full_name }`);
      continue;
    }
    // PR target must merge into the default branch.
    if (pr.base.ref !== base) {
      console.log(`Skipping ${ item.number }: incorrect base ref ${ pr.base.ref }`);
      continue;
    }
    // Must not be a cross-repository (fork) pull request.
    if (pr.head.repo && pr.head.repo.full_name !== fullRepo) {
      console.log(`Skipping ${ item.number }: incorrect head repo ${ pr.head.repo.full_name }`);
      continue;
    }
    // Must be a pull request from the expected branch.
    if (pr.head.ref !== branch) {
      console.log(`Skipping ${ item.number }: incorrect head ref ${ pr.head.ref }`);
      continue;
    }

    return item;
  }
}

(async() => {
  const rawPayload = await fs.promises.readFile(getEnv('GITHUB_EVENT_PATH'), 'utf-8');
  const payload: GitHubReleasePayload = JSON.parse(rawPayload);
  const tagName = payload.release.tag_name;
  const fullRepo = getEnv('GITHUB_REPOSITORY');
  const [, owner, repo] = /([^/]+)\/(.*)/.exec(fullRepo) ?? [];

  if (!owner || !repo) {
    throw new TypeError(`Could not determine owner from ${ fullRepo }`);
  }
  if (!tagName) {
    throw new TypeError(`Could not detect tag from ${ rawPayload }`);
  }
  console.log(`Processing release event on ${ owner }/${ repo } for tag ${ tagName }...`);

  const branch = await getBranch(owner, repo, tagName);
  const existing = await findExisting(owner, repo, branch);

  if (existing) {
    console.log(`Found existing PR ${ existing.number }: ${ existing.html_url }`);

    return;
  }

  console.log(`Creating new PR on ${ owner }/${ repo }: ${ base } <- ${ branch }`);
  const title = `Merge release ${ tagName } back into ${ base }`;
  const { data: item } = await getOctokit().rest.pulls.create({
    owner, repo, title, head: branch, base, maintainer_can_modify: true,
  });

  console.log(`Created PR #${ item.number }: ${ item.html_url }`);
})().catch((ex) => {
  console.error(ex);
  process.exit(1);
});
