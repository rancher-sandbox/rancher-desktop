limactl() {
    is_macos && LIMA_HOME="$HOME/Library/Application Support/rancher-desktop/lima" \
             "/Applications/Rancher Desktop.app/Contents/Resources/resources/darwin/lima/bin/limactl" "$@"
    is_linux && LIMA_HOME="$HOME/.local/share/rancher-desktop/lima" \
             "/opt/rancher-desktop/resources/resources/linux/lima/bin/limactl" "$@"
}
