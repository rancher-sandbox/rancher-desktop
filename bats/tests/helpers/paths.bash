# PATH_BATS_ROOT, PATH_BATS_LOGS, and PATH_BATS_HELPERS are already set by load.bash

PATH_REPO_ROOT=$(absolute_path "$PATH_BATS_ROOT/..")

inside_repo_clone() {
    [ -d "$PATH_REPO_ROOT/pkg/rancher-desktop" ]
}

set_path_resources() {
    local system=$1
    local user=$2
    local dist=$3
    local subdir=$4
    local fd=3

    if [[ ! -e /dev/fd/3 ]]; then
        fd=2
    fi

    if [ -z "${RD_LOCATION:-}" ]; then
        if [ -d "$system" ]; then
            RD_LOCATION=system
        elif [ -d "$user" ]; then
            RD_LOCATION=user
        elif [ -d "$dist" ]; then
            RD_LOCATION=dist
        elif inside_repo_clone; then
            RD_LOCATION=dev
        else
            (
                echo "Couldn't locate Rancher Desktop in"
                echo "- \"$system\""
                echo "- \"$user\""
                echo "- \"$dist\""
                echo "and 'yarn dev' is unavailable outside repo clone"
            ) >&$fd
            exit 1
        fi
    fi
    if using_dev_mode; then
        if is_windows; then
            fatal "yarn operation not yet implemented for Windows"
        fi
        PATH_RESOURCES="$PATH_REPO_ROOT/resources"
    else
        PATH_RESOURCES="${!RD_LOCATION}/${subdir}"
    fi
    if [ ! -d "$PATH_RESOURCES" ]; then
        fatal "App resource directory '$PATH_RESOURCES' does not exist"
    fi
}

if is_macos; then
    PATH_APP_HOME="$HOME/Library/Application Support/rancher-desktop"
    PATH_CONFIG="$HOME/Library/Preferences/rancher-desktop"
    PATH_CACHE="$HOME/Library/Caches/rancher-desktop"
    PATH_LOGS="$HOME/Library/Logs/rancher-desktop"
    PATH_EXTENSIONS="$PATH_APP_HOME/extensions"
    LIMA_HOME="$PATH_APP_HOME/lima"
    PATH_SNAPSHOTS="$PATH_APP_HOME/snapshots"
    PATH_CONTAINERD_SHIMS="$PATH_APP_HOME/containerd-shims"

    ELECTRON_DIST_ARCH="mac"
    if is_macos aarch64; then
        ELECTRON_DIST_ARCH="mac-arm64"
    fi
    set_path_resources \
        "/Applications/Rancher Desktop.app" \
        "$HOME/Applications/Rancher Desktop.app" \
        "$PATH_REPO_ROOT/dist/$ELECTRON_DIST_ARCH/Rancher Desktop.app" \
        "Contents/Resources/resources"
fi

if is_linux; then
    PATH_APP_HOME="$HOME/.local/share/rancher-desktop"
    PATH_CONFIG="$HOME/.config/rancher-desktop"
    PATH_CACHE="$HOME/.cache/rancher-desktop"
    PATH_LOGS="$PATH_APP_HOME/logs"
    PATH_EXTENSIONS="$PATH_APP_HOME/extensions"
    LIMA_HOME="$PATH_APP_HOME/lima"
    PATH_SNAPSHOTS="$PATH_APP_HOME/snapshots"
    PATH_CONTAINERD_SHIMS="$PATH_APP_HOME/containerd-shims"

    set_path_resources \
        "/opt/rancher-desktop" \
        "$HOME/opt/rancher-desktop" \
        "$PATH_REPO_ROOT/dist/linux-unpacked" \
        "resources/resources"
fi

wslpath_from_win32_env() {
    # The cmd.exe _sometimes_ returns an empty string when invoked in a subshell
    # wslpath "$(cmd.exe /c "echo %$1%" 2>/dev/null)" | tr -d "\r"
    # Let's see if powershell.exe avoids this issue
    wslpath "$(powershell.exe -Command "Write-Output \${Env:$1}")" | tr -d "\r"
}

if is_windows; then
    LOCALAPPDATA="$(wslpath_from_win32_env LOCALAPPDATA)"
    PROGRAMFILES="$(wslpath_from_win32_env ProgramFiles)"
    SYSTEMROOT="$(wslpath_from_win32_env SystemRoot)"

    PATH_APP_HOME="$LOCALAPPDATA/rancher-desktop"
    PATH_CONFIG="$LOCALAPPDATA/rancher-desktop"
    PATH_CACHE="$PATH_APP_HOME/cache"
    PATH_LOGS="$PATH_APP_HOME/logs"
    PATH_DISTRO="$PATH_APP_HOME/distro"
    PATH_DISTRO_DATA="$PATH_APP_HOME/distro-data"
    PATH_EXTENSIONS="$PATH_APP_HOME/extensions"
    PATH_SNAPSHOTS="$PATH_APP_HOME/snapshots"
    PATH_CONTAINERD_SHIMS="$PATH_APP_HOME/containerd-shims"

    set_path_resources \
        "$PROGRAMFILES/Rancher Desktop" \
        "$LOCALAPPDATA/Programs/Rancher Desktop" \
        "$PATH_REPO_ROOT/dist/win-unpacked" \
        "resources/resources"
fi

PATH_CONFIG_FILE="$PATH_CONFIG/settings.json"

USERPROFILE=$HOME
if using_windows_exe; then
    USERPROFILE="$(wslpath_from_win32_env USERPROFILE)"
fi

host_path() {
    local path=$1
    if using_windows_exe; then
        path=$(wslpath -w "$path")
    fi
    echo "$path"
}
