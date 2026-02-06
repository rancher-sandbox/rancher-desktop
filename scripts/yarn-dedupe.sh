#!/bin/bash

# Deduplicate yarn.lock and create a pull request if anything changes.
# Expects to run from the repository root on the main branch.

set -eu

BRANCH_NAME="yarn-dedupe"
NEW_PR="true"

if git rev-parse --verify "origin/${BRANCH_NAME}" 2>/dev/null; then
    NEW_PR="false"
fi

yarn dedupe

# Exit if yarn.lock is unchanged
if git diff --quiet yarn.lock; then
    echo "yarn dedupe made no changes."
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

if [ "$NEW_PR" = "false" ]; then
    exit
fi

gh pr create \
    --title "Deduplicate yarn.lock" \
    --body "Automated pull request to remove duplicate dependency resolutions from yarn.lock." \
    --head "$BRANCH_NAME" \
    --base main
