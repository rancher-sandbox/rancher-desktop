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

download_artifact() {
    local filename="$1"
    local leaf
    leaf="$(basename "$1")"

    # Get the artifact id for the package
    API="repos/$OWNER/$REPO/actions/runs/$ID/artifacts"
    FILTER=".artifacts[] | select(.name == \"$leaf\").id"

    ARTIFACT_ID=$(gh api "$API" --jq "$FILTER")
    if [ -z "$ARTIFACT_ID" ]; then
        echo "No download url for '$leaf' from $WORKFLOW run $ID"
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
        archive="${TMPDIR:-/tmp}/Rancher Desktop-mac.$ARCH.zip"
    elif [[ "$(uname -r)" =~ "WSL2" ]]; then
        archive="${TMPDIR:-/tmp}/Rancher Desktop-win.zip"
    else
        archive="${TMPDIR:-/tmp}/Rancher Desktop-linux.zip"
    fi
    download_artifact "$archive"

    # Artifacts are zipped, so extract inner ZIP file from outer wrapper.
    # The outer ZIP has a predictable name like "Rancher Desktop-mac.x86_64.zip"
    # but the inner one has a version string: "Rancher Desktop-1.7.0-1061-g91ab3831-mac.zip"
    # Run unzip in "zipinfo" mode, which can print just the file name.
    local ZIP
    ZIP="$(unzip -Z -1 "$archive" | head -n1)"
    if [ -z "$ZIP" ]; then
        echo "Cannot find inner archive in $(basename "$archive")"
        exit 1
    fi
    local zip_full="${TMPDIR:-/tmp}/$ZIP"

    unzip -o "$archive" "$ZIP" -d "${TMPDIR:-/tmp}"
    local DEST

    if [[ "$(uname -s)" == "Darwin" ]]; then
        # Extract from inner archive into /Applications
        DEST="/Applications"
        if [ "$RD_LOCATION" = "user" ]; then
            DEST="$HOME/$DEST"
        fi

        APP="Rancher Desktop.app"
        rm -rf "${DEST:?}/$APP"
        unzip -o "$zip_full" "$APP/*" -d "$DEST" >/dev/null
    elif [[ "$(uname -r)" =~ "WSL2" ]]; then
        LOCALAPPDATA="$(wslpath_from_win32_env LOCALAPPDATA)"
        PROGRAMFILES="$(wslpath_from_win32_env ProgramFiles)"
        DEST="$PROGRAMFILES"
        if [ "$RD_LOCATION" = "user" ]; then
            DEST="$LOCALAPPDATA/Programs"
        fi
        APP="Rancher Desktop"
        rm -rf "${DEST:?}/$APP"
        unzip -o "$zip_full" "$APP/*" -d "$DEST" >/dev/null
    else
        # Linux doesn't support per-user installs
        DEST="/opt/rancher-desktop"
        sudo rm -rf "${DEST:?}"
        sudo unzip -o "$zip_full" -d "$DEST" >/dev/null
    fi
}

download_bats() {
    pushd "${TMPDIR:-/tmp}"
    download_artifact "bats.tar.gz"

    # GitHub always wraps the artifact in a zip file, so the downloaded file
    # actually has an incorrect name; extract it in place.
    mv bats.tar.gz bats.tar.gz.zip
    unzip -o bats.tar.gz.zip bats.tar.gz

    # Unpack bats into $BATS_DIR
    rm -rf "$BATS_DIR"
    mkdir "$BATS_DIR"
    tar xfz "bats.tar.gz" -C "$BATS_DIR"
    popd
}

API_ARGS="exclude_pull_requests=true"

# Get branch name for PR (even if this refers to a fork, the run is still in the
# target repo with that branch name).
if [[ -n $PR ]]; then
    BRANCH=$(gh api "repos/$OWNER/$REPO/pulls/$PR" --jq .head.ref)
    API_ARGS="event=pull_request"
fi

# Get the latest workflow run that succeeded in this repo.
API="repos/$OWNER/$REPO/actions/workflows/$WORKFLOW/runs?branch=$BRANCH&status=success&per_page=1&$API_ARGS"
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
