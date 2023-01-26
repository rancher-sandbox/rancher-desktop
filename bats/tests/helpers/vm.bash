wait_for_shell() {
    try --max 24 --delay 5 $RDCTL shell test -f /var/run/lima-boot-done
    # wait until sshfs mounts are done
    try --max 12 --delay 5 $RDCTL shell test -d $HOME/.rd
    $RDCTL shell sync
}

assert_rd_is_stopped() {
    if is_macos; then
        # ! pgrep -f "Rancher Desktop.app/Contents/MacOS/Rancher Desktop"
        osascript -e 'if application "Rancher Desktop" is running then error 1' 2>/dev/null
    elif is_linux; then
        ! pgrep rancher-desktop &>/dev/null
    fi
}

wait_for_shutdown() {
    try --max 18 --delay 5 assert_rd_is_stopped
}

factory_reset() {
    $RDCTL factory-reset
    if is_linux; then
        RD_CONFIG_FILE=$HOME/.config/rancher-desktop/settings.json
    elif is_macos; then
        RD_CONFIG_FILE=$HOME/Library/Preferences/rancher-desktop/settings.json
    fi

    # hack for tests/registry/creds.bats because we can't configure additional
    # hosts via settings.yaml
    mkdir -p "$(lima_home)/_config"
    override="$(lima_home)/_config/override.yaml"
    touch "$override"
    if ! grep -q registry.internal: "$override"; then
        cat <<EOF >>"$override"

hostResolver:
  hosts:
    registry.internal: 192.168.5.15
EOF
    fi

    if [ "$RD_USE_IMAGE_ALLOW_LIST" != "false" ]; then
        RD_USE_IMAGE_ALLOW_LIST=true
    fi

    mkdir -p $(dirname $RD_CONFIG_FILE)
    # Make sure supressSudo is true
    cat <<EOF > $RD_CONFIG_FILE
{
  "version": 4,
  "kubernetes": {
    "memoryInGB": 6,
    "suppressSudo": true
  },
  "updater": false,
  "pathManagementStrategy": "rcfiles",
  "containerEngine": {
    "imageAllowList": {
      "enabled": $RD_USE_IMAGE_ALLOW_LIST,
      "patterns": ["docker.io"]
    }
  }
}
EOF
}

start_container_runtime() {
    local container_runtime="${1:-$RD_CONTAINER_RUNTIME}"
    if is_macos; then
        open -a "Rancher Desktop" --args \
             --kubernetes-containerEngine "$container_runtime" \
             --kubernetes-enabled=false
    elif is_linux; then
        $RDCTL start \
               --container-engine="$container_runtime" \
               --kubernetes-enabled=false 3>&-
    fi
}

start_application() {
    "$RDCTL_resources" start \
           --container-engine "$RD_CONTAINER_RUNTIME" \
           --kubernetes-enabled \
           --kubernetes-version "$RD_KUBERNETES_PREV_VERSION" \
           --path-management-strategy rcfiles \
           --kubernetes.suppress-sudo \
           --updater=false
}
