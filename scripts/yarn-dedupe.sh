#!/bin/bash

# Deduplicate yarn.lock and optionally push a pull request.
# Expects to run from the repository root on the main branch.
#
# Usage: yarn-dedupe.sh [--push]
#
# Without --push, runs yarn dedupe and reports changes (safe for local use).
# With --push, commits, pushes, and creates a PR if one does not already exist.

set -eu

PUSH="false"
for arg in "$@"; do
    case "$arg" in
        --push) PUSH="true" ;;
        *) echo "Unknown option: $arg" >&2; exit 1 ;;
    esac
done

BRANCH_NAME="yarn-dedupe"

yarn dedupe

# Exit if yarn.lock is unchanged
if git diff --quiet yarn.lock; then
    echo "yarn.lock is already deduplicated."
    exit
fi

if [ "$PUSH" = "false" ]; then
    echo "yarn.lock has duplicates that yarn dedupe would remove."
    echo "Run with --push to commit, push, and open a PR."
    git diff --stat yarn.lock
    exit
fi

export GIT_CONFIG_COUNT=2
export GIT_CONFIG_KEY_0=user.name
export GIT_CONFIG_VALUE_0="Rancher Desktop GitHub Action"
export GIT_CONFIG_KEY_1=user.email
export GIT_CONFIG_VALUE_1="donotuse@rancherdesktop.io"

git checkout -B "$BRANCH_NAME"
git add yarn.lock
git commit --signoff --message "Run yarn dedupe"
git push --force origin "$BRANCH_NAME"

# Create a PR only if one does not already exist for this branch.
if gh pr list --head "$BRANCH_NAME" --json number --jq '.[].number' | grep --quiet .; then
    echo "PR already exists for branch $BRANCH_NAME; skipping creation."
else
    gh pr create \
        --title "Deduplicate yarn.lock" \
        --body "Automated pull request to remove duplicate dependency resolutions from yarn.lock." \
        --head "$BRANCH_NAME" \
        --base main
fi
