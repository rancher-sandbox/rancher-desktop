limactl() {
    if is_macos; then
        RESOURCES="/Applications/Rancher Desktop.app/Contents/Resources/resources/darwin"
    elif is_linux; then
        RESOURCES="/opt/rancher-desktop/resources/resources/linux"
    fi
    LIMA_HOME="$(lima_home)" "${RESOURCES}/lima/bin/limactl" "$@"
}

lima_home() {
    if is_macos; then
        echo "${HOME}/Library/Application Support/rancher-desktop/lima"
    elif is_linux; then
        echo "${HOME}/.local/share/rancher-desktop/lima"
    fi
}
