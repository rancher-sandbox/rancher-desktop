#!/bin/bash

# This script expects to be called from the root of the repo.
# It will rebuild resources/k3s-versions.json from both the k3s update
# channel and the GitHub k3s releases list.
# Creates a pull request if the new version is different.

set -eu

K3S_VERSIONS="resources/k3s-versions.json"
BRANCH_NAME="gha-update-k3s-versions"
NEW_PR="true"

if git rev-parse --verify "origin/${BRANCH_NAME}" 2>/dev/null; then
    # This logic relies on the fact that PR branches inside the repo get automatically
    # deleted when the PR has been merged. We assume that if the branch exists, there
    # is also a corresponding PR for it, so we just update the branch with a new commit.
    git checkout "$BRANCH_NAME"
    NEW_PR="false"
else
    git checkout -b "$BRANCH_NAME"
fi

go run ./scripts/k3s-versions.go >"$K3S_VERSIONS"

# Exit if there are no changes
if git diff --exit-code; then
    exit
fi

export GIT_CONFIG_COUNT=2
export GIT_CONFIG_KEY_0=user.name
export GIT_CONFIG_VALUE_0="Rancher Desktop GitHub Action"
export GIT_CONFIG_KEY_1=user.email
export GIT_CONFIG_VALUE_1="donotuse@rancherdesktop.io"

git add "$K3S_VERSIONS"
git commit --signoff --message "Automated update: k3s-versions.json"
git push origin "$BRANCH_NAME"

if [ "$NEW_PR" = "false" ]; then
    exit
fi

gh pr create \
    --title "Update k3s-versions.json" \
    --body "This pull request contains the latest update to k3s-versions.json." \
    --head "$BRANCH_NAME" \
    --base main
