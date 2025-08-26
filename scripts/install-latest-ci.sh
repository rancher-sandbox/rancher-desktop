#!/usr/bin/env bash

# Download the latest CI build and install it.
# NOTE On Linux, "user" installs to `~/opt/rancher-desktop`

set -o errexit -o nounset -o pipefail
set -o xtrace

: "${OWNER:=rancher-sandbox}" # Repository owner to fetch from
: "${REPO:=rancher-desktop}"  # Repository to fetch from
: "${BRANCH:=main}"           # Branch to fetch from
: "${PR:=}"                   # PR number to fetch from (overrides BRANCH)
: "${ID:=}"                   # If set, use the specific Action run.
: "${WORKFLOW:=package.yaml}" # Name of workflow that must have succeeded
: "${BATS_DIR:=${TMPDIR:-/tmp}/bats}" # Directory to extract BATS tests to.
: "${INSTALL_MODE:=zip}"      # One of `skip`, `zip`, or `installer`
: "${ZIP_NAME:=}"             # If set, output the zip file name to this file.

: "${RD_LOCATION:=user}"

if ! [[ $RD_LOCATION =~ ^(system|user)$ ]]; then
    echo "RD_LOCATION must be either 'system' or 'user' (got '$RD_LOCATION')" >&2
    exit 1
fi
if ! [[ $INSTALL_MODE =~ ^(skip|zip|installer)$ ]]; then
    echo "INSTALL_MODE must be one of 'skip', 'zip', or 'installer' (got '$INSTALL_MODE')" >&2
    echo "  skip:      Do not install at all"
    echo "  zip:       Install from the zip file (default)"
    echo "  installer: Install from the installer (or from zip file if not available)"
    exit 1
fi

: "${TMPDIR:=/tmp}" # If TMPDIR is unset, set it to something reasonable.

get_platform() {
    case "$(uname -s)%%$(uname -r)" in
    Darwin*)
        echo darwin;;
    MINGW*|*-WSL2)
        echo win32;;
    *)
        echo linux;;
    esac
}

# Get the run ID and store it into the global environment variable $ID.
# May also update $BRANCH for pull requests.
determine_run_id() {
    if [[ -n $ID ]]; then
        return 0
    fi
    local args=(
        --repo "$OWNER/$REPO"
        run list
        --status success
        --workflow "$WORKFLOW"
        --limit 1
        --json databaseId
        --jq '.[].databaseId'
    )
    if [[ -n $PR ]]; then
        BRANCH=$(gh pr view --repo "$OWNER/$REPO" --json headRefName --jq .headRefName "$PR")
        args+=(--event pull_request)
    fi
    if [[ -z $BRANCH ]]; then
        echo "Failed to find relevant branch to download from" >&2
        exit 1
    fi
    args+=(--branch "$BRANCH")
    ID=$(gh "${args[@]}")
    if [[ -z $ID ]]; then
        echo "Failed to find run ID to download from" >&2
        exit 1
    fi
}

wslpath_from_win32_env() {
    if [[ "$(uname -s)" =~ MINGW* ]]; then
        # When running under WSL, the environment variables are set but to
        # Windows-style paths; however, `cd` works with those.  Also, under
        # MinGW the relevant variables are upper case.
        local var="${1^^}"
        (
            cd "${!var}"
            pwd
        )
    else
        # The cmd.exe _sometimes_ returns an empty string when invoked in a subshell
        # wslpath "$(cmd.exe /c "echo %$1%" 2>/dev/null)" | tr -d "\r"
        # Let's see if powershell.exe avoids this issue
        wslpath "$(powershell.exe -Command "Write-Output \${Env:$1}")" | tr -d "\r"
    fi
}

install_application() {
    local archive workdir

    # While the artifact has a consistent name, the single file inside the
    # artifact does not.  Create a temporary directory that `gh run download`
    # will download into, so we can pick out the file that it creates.
    workdir=$(mktemp -d "$TMPDIR/rd-install.XXXXXXXXXX")
    if [[ -z "$workdir" || ! -d "$workdir" ]]; then
        echo "Failed to create temporary directory" >&2
        exit 1
    fi
    case "$(get_platform)" in
    darwin)
        ARCH=x86_64
        if [ "$(uname -m)" = "arm64" ]; then
            ARCH=aarch64
        fi
        archive="Rancher Desktop-mac.$ARCH.zip"
        ;;
    win32)
        case $INSTALL_MODE in
        zip)
            archive="Rancher Desktop-win.zip"
            ;;
        installer)
            archive="Rancher Desktop Setup.msi"
            ;;
        esac
        ;;
    linux)
        archive="Rancher Desktop-linux.zip"
        ;;
    esac
    gh run download --repo "$OWNER/$REPO" "$ID" --dir "$workdir" --name "$archive"

    # `gh run download` extracts the artifact into the provided directory.
    local zip=("$workdir"/*)
    if [[ "${#zip[@]}" -ne 1 ]]; then
        echo "Cannot find artifact from $archive"
        rm -rf "$workdir"
        exit 1
    fi
    local zip_abspath="$TMPDIR/${zip[0]##*/}"
    mv "${zip[0]}" "$zip_abspath"
    rm -rf "$workdir"

    if [[ -n $ZIP_NAME ]]; then
        echo "${zip_abspath##*/}" > "$ZIP_NAME"
    fi

    local dest

    case "$(get_platform)" in
    darwin)
        # Extract from inner archive into /Applications
        dest="/Applications"
        if [ "$RD_LOCATION" = "user" ]; then
            dest="$HOME/$dest"
        fi

        local app="Rancher Desktop.app"
        rm -rf "${dest:?}/$app"
        unzip -o "$zip_abspath" "$app/*" -d "$dest" >/dev/null
        ;;
    win32)
        case $INSTALL_MODE in
        zip)
            local app='Rancher Desktop'
            case "$RD_LOCATION" in
            system)
                dest="$(wslpath_from_win32_env ProgramFiles)";;
            user)
                dest="$(wslpath_from_win32_env LOCALAPPDATA)/Programs";;
            *)
                printf "Installing to %s is not supported on Windows.\n" \
                    "$RD_LOCATION" >&2
                exit 1;;
            esac
            rm -rf "${dest:?}/$app"
            # For some reason, the Windows archive doesn't put everything in a
            # subdirectory like Linux & macOS do.
            mkdir -p "$dest/$app"
            unzip -o "$zip_abspath" -d "$dest/$app" >/dev/null
            ;;
        installer)
            local allusers=1
            local installer
            installer=$(cygpath --windows "$zip_abspath")
            case "$RD_LOCATION" in
                system)
                    ;;
                user)
                    allusers=0;;
                *)
                    printf "Installing to %s is not supported on Windows.\n" \
                        "$RD_LOCATION" >&2
                    exit 1;;
            esac
            MSYS2_ARG_CONV_EXCL='*' msiexec.exe \
                /i "$installer" /passive /norestart \
                ALLUSERS=$allusers WSLINSTALLED=1
            # msiexec returns immediately and runs in the background; wait for that
            # process to exit before continuing.
            local deadline completed
            deadline=$(( $(date +%s) + 10 * 60 ))
            while [[ $(date +%s) -lt $deadline ]]; do
                if MSYS2_ARG_CONV_EXCL='*' tasklist.exe /FI "ImageName eq msiexec.exe" | grep msiexec; then
                    printf "Waiting for msiexec to finish: %s/%s\n" "$(date)" "$(date --date="@$deadline")"
                    sleep 10
                else
                    completed=true
                    break
                fi
            done
            if [[ -z "${completed:-}" ]]; then
                echo "msiexec took too long to finish, aborting" >&2
                exit 1
            fi
            ;;
        esac
        ;;
    linux)
        case $RD_LOCATION in
        system)
            dest="/opt/rancher-desktop"
            sudo rm -rf "${dest:?}"
            sudo unzip -o "$zip_abspath" -d "$dest" >/dev/null
            sudo chmod 04755 "${dest}/chrome-sandbox"
            ;;
        user)
            dest="$HOME/opt/rancher-desktop"
            mkdir -p "${dest:?}" # Ensure the parent directory exists.
            rm -rf "${dest:?}"
            unzip -o "$zip_abspath" -d "$dest" >/dev/null
            sudo chown root:root "${dest}/chrome-sandbox"
            sudo chmod 04755 "${dest}/chrome-sandbox"
            ;;
        esac
        ;;
    esac
}

download_bats() {
    # Download the BATS archive; it's automatically extracted one level, i.e.
    # the wrapper zip file.
    rm -f "$TMPDIR/bats.tar.gz"
    gh run download --repo "$OWNER/$REPO" "$ID" --dir "$TMPDIR" --name bats.tar.gz

    # Unpack bats into $BATS_DIR
    rm -rf "$BATS_DIR"
    mkdir -p "$BATS_DIR"
    # Windows tar doesn't like $BATS_DIR when it's a Windows-style path.
    # So instead of using tar -C, enter that directory first.
    (
        cd "$BATS_DIR"
        tar xfz "$TMPDIR/bats.tar.gz"
    )
}

determine_run_id

if [[ "$INSTALL_MODE" != "skip" ]]; then
    install_application
fi
download_bats
