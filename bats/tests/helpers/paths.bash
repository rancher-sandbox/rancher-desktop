# PATH_BATS_ROOT and PATH_BATS_HELPERS are already set by load.bash

PATH_REPO_ROOT=$(absolute_path "$PATH_BATS_ROOT/..")

inside_repo_clone() {
    [ -d "$PATH_REPO_ROOT/pkg/rancher-desktop" ]
}

set_path_resources() {
    local system=$1
    local user=$2
    local dist=$3
    local subdir=$4

    if [ -z "$RD_LOCATION" ]; then
        if [ -d "$system" ]; then
            RD_LOCATION=system
        elif [ -d "$user" ]; then
            RD_LOCATION=user
        elif [ -d "$dist" ]; then
            RD_LOCATION=dist
        elif inside_repo_clone; then
            RD_LOCATION=npm
        else
            (
                echo "Couldn't locate Rancher Desktop in"
                echo "- \"$system\""
                echo "- \"$user\""
                echo "- \"$dist\""
                echo "and 'npm run dev' is unavailable outside repo clone"
            ) >&3
            exit 1
        fi
    fi
    if using_npm_run_dev; then
        if is_windows; then
            fatal "npm operation not yet implemented for Windows"
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

    ELECTRON_DIST_ARCH="mac"
    if is_macos arm64; then
        ELECTRON_DIST_ARCH="mac-arm64"
    fi
    set_path_resources \
        "/Applications/Rancher Desktop.app" \
        "$HOME/Applications/Rancher Desktop.app" \
        "$PATH_REPO_ROOT/dist/$ELECTRON_DIST_ARCH/Rancher Desktop.app" \
        "Contents/Resources/resources"
fi

if is_linux; then
    PATH_APP_HOME="$HOME/.config/rancher-desktop"
    PATH_CONFIG="$HOME/.config/rancher-desktop"
    PATH_CACHE="$HOME/.cache/rancher-desktop"
    PATH_DATA="$HOME/.local/share/rancher-desktop"
    PATH_LOGS="$PATH_DATA/logs"
    PATH_EXTENSIONS="$PATH_DATA/extensions"
    LIMA_HOME="$PATH_DATA/lima"

    set_path_resources \
        "/opt/rancher-desktop" \
        "/no user location on linux" \
        "$PATH_REPO_ROOT/dist/linux-unpacked" \
        "resources/resources"
fi

win32env() {
    # The cmd.exe _sometimes_ returns an empty string when invoked in a subshell
    # wslpath "$(cmd.exe /c "echo %$1%" 2>/dev/null)" | tr -d "\r"
    # Let's see if powershell.exe avoids this issue
    wslpath "$(powershell.exe -Command "Write-Output \${Env:$1}")" | tr -d "\r"
}

if is_windows; then
    APPDATA="$(win32env APPDATA)"
    LOCALAPPDATA="$(win32env LOCALAPPDATA)"
    PROGRAMFILES="$(win32env ProgramFiles)"

    PATH_APP_HOME="$APPDATA/rancher-desktop"
    PATH_CONFIG="$APPDATA/rancher-desktop"
    PATH_DATA="$LOCALAPPDATA/rancher-desktop"
    PATH_CACHE="$PATH_DATA/cache"
    PATH_LOGS="$PATH_DATA/logs"
    PATH_DISTRO="$PATH_DATA/distro"
    PATH_DISTRO_DATA="$PATH_DATA/distro-data"
    PATH_EXTENSIONS="$PATH_DATA/extensions"

    set_path_resources \
        "$PROGRAMFILES/Rancher Desktop" \
        "$LOCALAPPDATA/Programs/Rancher Desktop" \
        "$PATH_REPO_ROOT/dist/win-unpacked" \
        "resources/resources"
fi

PATH_CONFIG_FILE="$PATH_CONFIG/settings.json"
