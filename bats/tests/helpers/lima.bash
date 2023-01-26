limactl() {
    LIMA_HOME="$(lima_home)" "$(resources_dir)/lima/bin/limactl" "$@"
}

lima_home() {
    if is_macos; then
        echo "${HOME}/Library/Application Support/rancher-desktop/lima"
    elif is_linux; then
        echo "${HOME}/.local/share/rancher-desktop/lima"
    fi
}

resources_dir() {
    if is_macos; then
        echo "/Applications/Rancher Desktop.app/Contents/Resources/resources/darwin"
    elif is_linux; then
        echo "/opt/rancher-desktop/resources/resources/linux"
    fi
}
