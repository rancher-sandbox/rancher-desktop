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
    run $RDCTL shutdown
    if [ $status -eq 0 ]; then
        wait_for_shutdown
    fi
    if [ $status -ne 0 ]; then
        if is_macos; then
            run osascript -e 'tell application "Rancher Desktop" to quit'
            wait_for_shutdown
        fi
        # terminate with extreme prejudice
        if is_linux; then
            run pkill rancher-desktop
        elif is_macos; then
            # needs -f option because pkill doesn't cope with spaces in process names
            run pkill -f "Rancher Desktop.app/Contents/MacOS/Rancher Desktop"
        fi
    fi
    limactl delete -f 0
    if is_linux; then
        RD_CONFIG_FILE=$HOME/.config/rancher-desktop/settings.json
    elif is_macos; then
        RD_CONFIG_FILE=$HOME/Library/Preferences/rancher-desktop/settings.json
    fi

    # hack for tests/registry/creds.bats because we can't configure additional
    # hosts via settings.yaml
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
