# github-runner-monitor

This is a command-line tool that manages a pool of ephemeral self-hosted GitHub
runners.  It:

- Polls the GitHub API to maintain a minimum number of GitHub runners with a
  given set of labels.
- Runs qemu to create local virtual machines that are used for new GitHub
  runners (for the above), registering them with GitHub with the same set of
  labels.
- Once a runner finishes executing a run (regardless of whether the run failed
  or succeeded), the runner is destroyed and unregistered.  On the next poll
  (see above) a new runner will be created.

The tool needs a GitHub token with the appropriate privileges to poll for
existing runners and create new ones; that can be either:

- A classic personal access token, with `repo` scope, or
- A fine-grained personal access token, scoped to only the relevant repository,
  with _repository_ `Administration` _write_ permissions.

The latter is preferred as that provides fewer permissions.

See `./github-runner-monitor --help` for defaults.

See [`/docs/development/github-runner-setup.md#Linux`] for the deployed
configuration.

[`/docs/development/github-runner-setup.md#Linux`]: /docs/development/github-runner-setup.md#Linux
