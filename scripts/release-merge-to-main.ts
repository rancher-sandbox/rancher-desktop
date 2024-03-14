// This file creates PRs when releases are published to merge back to the main
// branch.

// Environment:
//   GITHUB_REPOSITORY, GITHUB_EVENT_PATH, and others
//     See https://docs.github.com/en/actions/learn-github-actions/variables#default-environment-variables
//   GITHUB_TOKEN: GitHub authorization token.
//     Must have write permissions for `actions`, `contents`, `pull_requests`.

import fs from 'fs';

import { RequestError } from 'octokit';

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
 * Ensure that the given branch exists, and points to the given tag.
 * @param owner The repository owner.
 * @param repo The repository name (without the owner).
 * @param branchName The name of the branch.
 * @param tagName The name of the tag.
 */
async function ensureBranch(owner: string, repo: string, branchName: string, tagName: string): Promise<void> {
  const ref = `heads/${ branchName }`;
  const { git } = getOctokit().rest;
  const { data: tagRef } = await git.getRef({
    owner, repo, ref: `tags/${ tagName }`,
  });
  const { sha } = tagRef.object;

  try {
    const { data: existingBranch } = await git.getRef({
      owner, repo, ref,
    });

    if (existingBranch.object.sha !== sha) {
    // Branch exists, but points at the wrong hash; update it.
      await git.updateRef({
        owner, repo, ref, sha,
      });
    }
  } catch (ex) {
    if (!(ex instanceof RequestError) || ex.status !== 404) {
      throw ex;
    }
    // Branch does not exist; create it.
    await git.createRef({
      // Only this API takes a `refs/` prefix; get & update omit it.
      owner, repo, ref: `refs/${ ref }`, sha,
    });
  }
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
  const branchName = `merge-${ tagName }`;
  const fullRepo = getEnv('GITHUB_REPOSITORY');
  const [, owner, repo] = /([^/]+)\/(.*)/.exec(fullRepo) ?? [];

  if (!owner || !repo) {
    throw new TypeError(`Could not determine owner from ${ fullRepo }`);
  }
  if (!tagName) {
    throw new TypeError(`Could not detect tag from ${ rawPayload }`);
  }
  console.log(`Processing release event on ${ owner }/${ repo } for tag ${ tagName }...`);

  const existing = await findExisting(owner, repo, branchName);

  if (existing) {
    console.log(`Found existing PR ${ existing.number }: ${ existing.html_url }`);

    // Note that the existing PR might not be from the same commit as the tag;
    // this is fine because somebody might have pushed commits on top to resolve
    // merge conflicts.  Ideally we'd check that the existing PR is a descendant
    // of the tag commit, but that would essentially involve doing a breadth-
    // first crawl from the head commit and any limits could lead to false
    // negatives.  (Or we clone and do `git merge-base --is-ancestor`...)
    return;
  }

  console.log(`Creating new PR on ${ owner }/${ repo }: ${ base } <- ${ branchName }`);
  await ensureBranch(owner, repo, branchName, tagName);
  const title = `Merge release ${ tagName } back into ${ base }`;
  const { data: item } = await getOctokit().rest.pulls.create({
    owner, repo, title, head: branchName, base, maintainer_can_modify: true,
  });

  console.log(`Created PR #${ item.number }: ${ item.html_url }`);
})().catch((ex) => {
  console.error(ex);
  process.exit(1);
});
