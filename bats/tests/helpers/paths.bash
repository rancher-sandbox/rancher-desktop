if is_macos; then
    PATH_APP_HOME="$HOME/Library/Application Support/rancher-desktop"
    PATH_CONFIG="$HOME/Library/Preferences/rancher-desktop"
    PATH_CACHE="$HOME/Library/Caches/rancher-desktop"
    PATH_LOGS="$HOME/Library/Logs/rancher-desktop"
    PATH_RESOURCES="/Applications/Rancher Desktop.app/Contents/Resources/resources/darwin"
    LIMA_HOME="$PATH_APP_HOME/lima"
fi

if is_linux; then
    PATH_APP_HOME="$HOME/.config/rancher-desktop"
    PATH_CONFIG="$HOME/.config/rancher-desktop"
    PATH_CACHE="$HOME/.local/cache/rancher-desktop"
    PATH_DATA="$HOME/.local/share/rancher-desktop"
    PATH_LOGS="$PATH_DATA/logs"
    PATH_RESOURCES="/opt/rancher-desktop/resources/resources/linux"
    LIMA_HOME="$PATH_DATA/lima"
fi

PATH_CONFIG_FILE="$PATH_CONFIG/settings.json"
