#!/usr/bin/env bash

# This script is expected to run from CI, and does a final smoke test.
# There should be an installer in the current directory (or, in the case of
# Linux, a zip file), along with its accompanying sha512sum file.
# On Windows, build/signing-config-win.yaml is also required.

# Environment variables as inputs:
#   RD_SKIP_INSTALL (Linux)
#     Skip installing Rancher Desktop, and assume it was installed from the repo.

# Required tools:
# - jq
# - yq (Windows only)

# Note that, on Windows, this is run via msys bash (installed wit git).

set -o errexit -o nounset
shopt -s nullglob

export MSYS2_ARG_CONV_EXCL='*'
RDCTL= # Path to rdctl
APPIMAGE_PID= # PID of AppImage process; not used if not using AppImage.

# All commands in the cleanups array will be run on exit.  They must be plain
# strings that will be passed to eval
cleanups=()

# Run the cleanups.
do_cleanup() {
    # In case the array has holes (it shouldn't), make an array of indices.
    local indices=("${!cleanups[@]}")
    local i
    for (( i=${#indices[@]} - 1; i >= 0; i-- )); do
        # shellcheck disable=2086 # We expect to glob and word split
        eval ${cleanups[$i]}
    done
}

trap do_cleanup EXIT

# Locate the archive, check its checksum, and echo the file name.
get_archive() {
    local checksum archiveName
    if [[ -n "${RD_SKIP_INSTALL:-}" ]]; then
        echo "Skipping getting archive." >&2
        echo "no-archive-used"
        return
    fi
    for checksum in *.sha512sum; do
        archiveName=${checksum%.sha512sum}
        if command -v sha512sum &>/dev/null; then
            sha512sum --check --quiet --strict "$checksum"
        else
            shasum --check --quiet --algorithm 512 "$checksum"
        fi
        grep --quiet "$archiveName" "$checksum"
        readlink -f "$archiveName"
        return
    done
    echo "Failed to find archive." >&2
    exit 1
}

# Return the current platform; one of "darwin", "linux", "win32"
get_platform() {
    case "$(uname -s)" in
    Darwin)
        echo "darwin";;
    Linux)
        echo "linux";;
    MINGW*)
        echo "win32";;
    *)
        printf "Unsupported platform %s\n" "$(uname -s)" >&2
        exit 1;;
    esac
}

# Assume the first argument given is a path to the Rancher Desktop .dmg disk
# image; install it, and set the global variable RDCTL to the path of the rdctl
# executable.
install_darwin() {
    local archiveName=$1
    local mountpoint
    mountpoint=$(mktemp -d -t rd-dmg-)
    cleanups+=("rm -rf '$mountpoint'")

    local srcApp="${mountpoint}/Rancher Desktop.app"
    local destApp="/Applications/Rancher Desktop.app"

    codesign --verify --deep --strict --verbose=2 --check-notarization "$archiveName"
    hdiutil attach "$archiveName" -mountpoint "$mountpoint"
    cleanups+=("hdiutil detach '$mountpoint'")

    codesign --verify --deep --strict --verbose=2 --check-notarization "$srcApp"
    mkdir -p "$destApp"
    cleanups+=("rm -rf '$destApp'")

    cp -a "$srcApp" "$(dirname "$destApp")"
    xattr -d -r -s -v com.apple.quarantine "$destApp"

    # Check that the image is compressed
    local compressionRatio
    compressionRatio="$(hdiutil imageinfo -plist "$archiveName" \
        | plutil -convert json -o - - \
        | jq '.["Size Information"]["Compressed Ratio"]')"
    if jq --exit-status '. > 0.9' <<<"$compressionRatio"; then
        printf "Archive %s appears to be uncompressed; compression ratio is %s\n" \
            "$archiveName" "$compressionRatio" >&2
        exit 1
    fi

    if [[ "$(uname -m)" =~ arm ]]; then
        # For macOS, currently only x86_64 runners support nested virtualization
        # https://github.com/actions/runner-images/issues/9460
        # Abort the script (gracefully) instead of trying to run RD.
        echo "Skipping actually running on Rancher Desktop because arm64 runners do not have nested virtualization" >&2
        exit 0
    fi

    RDCTL="$destApp/Contents/Resources/resources/darwin/bin/rdctl"
}

# Assume the first argument given is a path to the Rancher Desktop zip file;
# install it, and set the global variable RDCTL to the path of the rdctl
# executable.  If the archive is an AppImage file instead, then this function
# instead sets APPIMAGE_PID.
install_linux() {
    if [[ $(id --user) -eq 0 ]]; then
        echo "This script should not be run as root" >&2
        exit 1
    fi

    if [[ -z "${RD_SKIP_INSTALL:-}" ]]; then
        local archiveName=$1

        if [[ "$archiveName" =~ .*\.AppImage$ ]]; then
            sudo chmod a+x "$archiveName"
            "$archiveName" \
                --no-sandbox --enable-logging=stderr --v=1 \
                --no-modal-dialogs --kubernetes.enabled \
                --application.updater.enabled=false&
            APPIMAGE_PID=$!
            return
        else
            sudo mkdir -p /opt/rancher-desktop
            sudo unzip -d /opt/rancher-desktop "$archiveName"
            sudo chmod 4755 /opt/rancher-desktop/chrome-sandbox
        fi
    fi

    RDCTL="/opt/rancher-desktop/resources/resources/linux/bin/rdctl"
}

# Helper function on Windows to verify the signature of a file (provided as the
# first argument).
win32_verify() {
    local path
    path="$(cygpath --windows "$1")"
    # When running GitHub actions, using `powershell.exe` here causes issues
    # with loading the `Microsoft.PowerShell.Security` module; using `pwsh.exe`
    # seems to be fine.  This is probably because the default shell is pwsh, and
    # the environment has paths to the PowerShell 7 version of the module, so it
    # tries to load that instead of the version appropriate for PowerShell.exe.
    local pwsh=(pwsh.exe -NoLogo -NoProfile -NonInteractive -Command)
    local stdout
    stdout=$("${pwsh[@]}" "\$(Get-AuthenticodeSignature '$path').Status")

    if [[ "$stdout" != "Valid" ]]; then
        printf "%s is not correctly signed:\n" "$path"
        "${pwsh[@]}" "Get-AuthenticodeSignature '$path' | Format-List"
        exit 1
    fi
}

# Assume the first argument given is a path to the Rancher Desktop installer;
# install it, and set the global variable RDCTL to the path of the rdctl
# executable.
install_win32() {
    local archiveName=$1

    win32_verify "$archiveName"
    mkdir -p "$(cygpath --unix "${RD_LOGS_DIR}")"
    msiexec.exe '/lv*x' "${RD_LOGS_DIR}\\install.log" \
        /i "$(cygpath --windows "$archiveName")" /passive ALLUSERS=1
    # msiexec returns immediately and runs in the background; wait for that
    # process to exit before continuing.
    local deadline completed
    deadline=$(( $(date +%s) + 10 * 60 ))
    while [[ $(date +%s) -lt $deadline ]]; do
        if tasklist.exe /FI "ImageName eq msiexec.exe" | grep msiexec; then
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
    local installDirectory
    installDirectory=$(cygpath --unix 'C:\Program Files\Rancher Desktop')
    local rdctl="$installDirectory/resources/resources/win32/bin/rdctl.exe"

    local -a keys
    mapfile -t keys < <(yq.exe 'keys | .[]' < build/signing-config-win.yaml)
    local key
    for key in "${keys[@]}"; do
        local expr='.[env(key)][] | select(. != "!*")'
        local -a values
        mapfile -t values < <(key=$key yq.exe "$expr" < build/signing-config-win.yaml)
        for value in "${values[@]}"; do
            if [[ "$value" == "wix-custom-action.dll" ]]; then
                # This file is not installed
                continue
            fi
            win32_verify "$installDirectory/$key/$value"
        done
    done

    # Verify that rdctl exists
    win32_verify "$rdctl"
    RDCTL=$rdctl
}

# Wait for the backend to be alive.  $RDCTL must be set (from the install_*
# functions).  If $APPIMAGE_PID is set, assume we're running AppImage instead.
wait_for_backend() {
    local deadline state deadline_date platform rd_pid
    deadline=$(( $(date +%s) + 10 * 60 ))
    deadline_date=$({ date --date="@$deadline" || date -j -f %s "$deadline"; } 2>/dev/null)
    platform=$(get_platform)

    while [[ $(date +%s) -lt $deadline ]]; do
        if [[ -n "${APPIMAGE_PID:-}" ]] && [[ -z "${RDCTL:-}" ]]; then
            rd_pid=$(pidof --separator $'\n' rancher-desktop | sort -n | head -n 1 || echo missing)
            if [[ -e /proc/$rd_pid/exe ]]; then
                RDCTL=$(dirname "$(readlink /proc/$rd_pid/exe)")/resources/resources/linux/bin/rdctl
                continue
            fi
            state=NOT_RUNNING
        elif [[ $platform == linux ]] && [[ ! -e $HOME/.local/share/rancher-desktop/rd-engine.json ]]; then
            state=NO_SERVER_CONFIG
        else
            state=$("$RDCTL" api /v1/backend_state || echo '{"vmState": "NO_RESPONSE"}')
            state=$(jq --raw-output .vmState <<< "$state")
        fi
        case "$state" in
            ERROR)
                echo "Backend reached error state." >&2
                exit 1 ;;
            STARTED|DISABLED)
                return ;;
            *)
                printf "Backend state: %s\n" "$state";;
        esac

        # if we get here, either we failed to get state or it's starting.
        printf "Waiting for backend: (%s) %s/%s\n" "$state" "$(date)" "$deadline_date"
        sleep 10
    done

    echo "Timed out waiting for backend to stabilize." >&2
    printf "Current time: %s\n" "$(date)" >&2
    printf "Deadline: %s\n" "$deadline_date" >&2
    exit 1
}

main() {
    local archive platform
    platform=$(get_platform)
    archive=$(get_archive)

    eval "install_${platform}" "$archive"
    if [[ -z "${APPIMAGE_PID:-}" ]]; then
        "$RDCTL" start --no-modal-dialogs \
            --kubernetes.enabled --application.updater.enabled=false
        cleanups+=("'$RDCTL' shutdown")
    fi
    wait_for_backend
    echo "Smoke test passed."
}

main
