#!/bin/bash

# Download the latest CI build and install it
# NOTE This currently only works for macOS and Linux; for Linux, this always
# installs to /opt (ignoring RD_LOCATION).

set -o errexit -o nounset -o pipefail
set -o xtrace

: "${OWNER:=rancher-sandbox}" # Repository owner to fetch from
: "${REPO:=rancher-desktop}"  # Repository to fetch from
: "${BRANCH:=main}"           # Branch to fetch from
: "${PR:=}"                   # PR number to fetch from (overrides BRANCH)
: "${WORKFLOW:=package.yaml}" # Name of workflow that must have succeeded
: "${BATS_DIR:=${TMPDIR:-/tmp}/bats}" # Directory to extract BATS tests to.
: "${SKIP_INSTALL:=}"         # If set, don't install the application.

: "${RD_LOCATION:=user}"

if ! [[ $RD_LOCATION =~ ^(system|user)$ ]]; then
    echo "RD_LOCATION must be either 'system' or 'user'"
    exit 1
fi

: "${TMPDIR:=/tmp}" # If TMPDIR is unset, set it to something reasonable.

download_artifact() {
    local filename="$1"
    local basename
    basename=$(basename "$1")

    # Get the artifact id for the package
    API="repos/$OWNER/$REPO/actions/runs/$ID/artifacts"
    FILTER=".artifacts[] | select(.name == \"$basename\").id"

    ARTIFACT_ID=$(gh api "$API" --jq "$FILTER")
    if [ -z "$ARTIFACT_ID" ]; then
        echo "No download url for '$basename' from $WORKFLOW run $ID"
        exit 1
    fi

    # Download the package. It requires authentication, so use gh instead of curl.
    API="repos/$OWNER/$REPO/actions/artifacts/$ARTIFACT_ID/zip"
    gh api "$API" > "$filename"
}

wslpath_from_win32_env() {
    # The cmd.exe _sometimes_ returns an empty string when invoked in a subshell
    # wslpath "$(cmd.exe /c "echo %$1%" 2>/dev/null)" | tr -d "\r"
    # Let's see if powershell.exe avoids this issue
    wslpath "$(powershell.exe -Command "Write-Output \${Env:$1}")" | tr -d "\r"
}

install_application() {
    local archive
    if [[ "$(uname -s)" == "Darwin" ]]; then
        ARCH=x86_64
        if [ "$(uname -m)" = "arm64" ]; then
            ARCH=aarch64
        fi
        archive="$TMPDIR/Rancher Desktop-mac.$ARCH.zip"
    elif [[ "$(uname -r)" =~ "WSL2" ]]; then
        archive="$TMPDIR/Rancher Desktop-win.zip"
    else
        archive="$TMPDIR/Rancher Desktop-linux.zip"
    fi
    download_artifact "$archive"

    # Artifacts are zipped, so extract inner zip file from outer wrapper.
    # The outer zip has a predictable name like "Rancher Desktop-mac.x86_64.zip"
    # but the inner one has a version string: "Rancher Desktop-1.7.0-1061-g91ab3831-mac.zip"
    # Run unzip in "zipinfo" mode, which can print just the file name.
    local zip
    zip="$(unzip -Z -1 "$archive" | head -n1)"
    if [ -z "$zip" ]; then
        echo "Cannot find inner archive in $(basename "$archive")"
        exit 1
    fi
    local zip_abspath="$TMPDIR/$zip"

    unzip -o "$archive" "$zip" -d "$TMPDIR"
    local DEST

    if [[ "$(uname -s)" == "Darwin" ]]; then
        # Extract from inner archive into /Applications
        DEST="/Applications"
        if [ "$RD_LOCATION" = "user" ]; then
            DEST="$HOME/$DEST"
        fi

        APP="Rancher Desktop.app"
        rm -rf "${DEST:?}/$APP"
        unzip -o "$zip_abspath" "$APP/*" -d "$DEST" >/dev/null
    elif [[ "$(uname -r)" =~ "WSL2" ]]; then
        LOCALAPPDATA="$(wslpath_from_win32_env LOCALAPPDATA)"
        PROGRAMFILES="$(wslpath_from_win32_env ProgramFiles)"
        DEST="$PROGRAMFILES"
        if [ "$RD_LOCATION" = "user" ]; then
            DEST="$LOCALAPPDATA/Programs"
        fi
        APP="Rancher Desktop"
        rm -rf "${DEST:?}/$APP"
        unzip -o "$zip_abspath" "$APP/*" -d "$DEST" >/dev/null
    else
        # Linux doesn't support per-user installs
        DEST="/opt/rancher-desktop"
        sudo rm -rf "${DEST:?}"
        sudo unzip -o "$zip_abspath" -d "$DEST" >/dev/null
    fi
}

download_bats() {
    download_artifact "$TMPDIR/bats.tar.gz"

    # GitHub always wraps the artifact in a zip file, so the downloaded file
    # actually has an incorrect name; extract it in place.
    mv "$TMPDIR/bats.tar.gz" "$TMPDIR/bats.tar.gz.zip"
    unzip -o "$TMPDIR/bats.tar.gz.zip" -d "$TMPDIR" bats.tar.gz

    # Unpack bats into $BATS_DIR
    rm -rf "$BATS_DIR"
    mkdir "$BATS_DIR"
    tar xfz "$TMPDIR/bats.tar.gz" -C "$BATS_DIR"
}

# Get branch name for PR (even if this refers to a fork, the run is still in the
# target repo with that branch name).
if [[ -n $PR ]]; then
    BRANCH=$(gh api "repos/$OWNER/$REPO/pulls/$PR" --jq .head.ref)
    API_ARGS="&event=pull_request"
fi

# Get the latest workflow run that succeeded in this repo.
API="repos/$OWNER/$REPO/actions/workflows/$WORKFLOW/runs?branch=$BRANCH&status=success&per_page=1${API_ARGS:-}"
FILTER=".workflow_runs[0].id"

ID=$(gh api "$API" --jq "$FILTER")
if [ -z "$ID" ]; then
    echo "No successful $WORKFLOW run found for $OWNER/$REPO branch $BRANCH"
    exit 1
fi

if [[ -z "$SKIP_INSTALL" ]]; then
    install_application
fi
download_bats
