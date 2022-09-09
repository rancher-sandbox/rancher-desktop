limactl() {
    if is_macos; then
        LIMA_HOME="$HOME/Library/Application Support/rancher-desktop/lima" \
                 "/Applications/Rancher Desktop.app/Contents/Resources/resources/darwin/lima/bin/limactl" "$@"
    elif is_linux; then
        LIMA_HOME="$HOME/.local/share/rancher-desktop/lima" \
                 "/opt/rancher-desktop/resources/resources/linux/lima/bin/limactl" "$@"
    fi
}
