#!/bin/bash

set -o errexit -o nounset -o pipefail
set -o xtrace

: ${OWNER:=rancher-sandbox}
: ${REPO:=rancher-desktop}
: ${BRANCH:=main}
: ${WORKFLOW:=Package}
: ${RESULTS:=30}

# Get a list of all successful workflow runs for this repo.
# I couldn't find a way to filter by workflow name, so get the last $RESULTS
# runs and hope that at least one of them was for $WORKFLOW.
API="repos/$OWNER/$REPO/actions/runs?branch=$BRANCH&status=success&per_page=$RESULTS"
FILTER="[.workflow_runs[] | select(.name == \"$WORKFLOW\")] | .[0].id"

ID=$(gh api "$API" --jq "$FILTER")
if [ -z "$ID" ]; then
    echo "No successful $WORKFLOW run found for branch $BRANCH"
    exit 1
fi

download_artifact() {
    FILENAME=$1

    # Get the artifact id for the package
    API="repos/$OWNER/$REPO/actions/runs/$ID/artifacts"
    FILTER=".artifacts[] | select(.name == \"$FILENAME\").id"

    ARTIFACT_ID=$(gh api "$API" --jq "$FILTER")
    if [ -z "$ARTIFACT_ID" ]; then
        echo "No download url for '$FILENAME' from $WORKFLOW run $ID"
        exit 1
    fi

    # Download the package. It requires authentication, so use gh instead of curl.
    API=repos/$OWNER/$REPO/actions/artifacts/$ARTIFACT_ID/zip
    gh api "$API" > "$TMPDIR/$FILENAME"
}

download_artifact "Rancher Desktop-mac.x86_64.zip"

# Artifacts are zipped, so extract inner ZIP file from outer wrapper.
# The outer ZIP has a predictable name like "Rancher Desktop-mac.x86_64.zip"
# but the inner one has version string: "Rancher Desktop-1.7.0-1061-g91ab3831-mac.zip"
# Extract filename from:
# ---------------------------------------------------------------------------
# $ unzip -l Rancher\ Desktop-mac.x86_64.zip
# Archive:  Rancher Desktop-mac.x86_64.zip
#   Length      Date    Time    Name
# ---------  ---------- -----   ----
# 617701842  04-18-2023 23:56   Rancher Desktop-1.7.0-1061-g91ab3831-mac.zip
# ---------                     -------
# 617701842                     1 file
# ---------------------------------------------------------------------------
ZIP=$(unzip -l "$TMPDIR/$FILENAME" | perl -ne 'print if s/^\d.*Rancher/Rancher/')
if [ -z "$ZIP" ]; then
    echo "Cannot find inner archive in $TMPDIR/$FILENAME"
    exit 1
fi

unzip -o "$TMPDIR/$FILENAME" "$ZIP" -d "$TMPDIR"

# Extract from inner archive into ~/Applications
APP="Rancher Desktop.app"
rm -rf "$HOME/Applications/$APP"
unzip -o "$TMPDIR/$ZIP" "$APP/*" -d "$HOME/Applications" >/dev/null

download_artifact "bats.tar.gz"

# Despite the name the downloaded bats.tar.gz is actually a ZIP file; extract in place
unzip -o "$TMPDIR/bats.tar.gz" bats.tar.gz -d "$TMPDIR"

# Unpack bats into $TMPDIR/bats
rm -rf "$TMPDIR/bats"
mkdir "$TMPDIR/bats"
tar xfz "$TMPDIR/bats.tar.gz" -C "$TMPDIR/bats"
