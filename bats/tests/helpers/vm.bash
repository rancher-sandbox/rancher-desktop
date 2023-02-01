wait_for_shell() {
    try --max 24 --delay 5 rdctl shell test -f /var/run/lima-boot-done
    # wait until sshfs mounts are done
    try --max 12 --delay 5 rdctl shell test -d $HOME/.rd
    rdctl shell sync
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
    rdctl factory-reset
    if is_unix; then
        factory_reset_lima
    fi
    if is_windows; then
        factory_reset_windows
    fi
}

factory_reset_lima() {
    # hack for tests/registry/creds.bats because we can't configure additional
    # hosts via settings.yaml
    mkdir -p "$LIMA_HOME/_config"
    override="$LIMA_HOME/_config/override.yaml"
    touch "$override"
    if [ -f "${RD_OVERRIDE:-/no such file}" ]; then
        cp "$RD_OVERRIDE" "$override"
    fi

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

    mkdir -p "$PATH_CONFIG"
    # Make sure supressSudo is true
    cat <<EOF > "$PATH_CONFIG_FILE"
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

factory_reset_windows() {
    run sudo ip link delete docker0
    run sudo ip link delete nerdctl0

    sudo iptables -F
    sudo iptables -L | awk '/^Chain CNI/ {print $2}' | xargs -l sudo iptables -X
}

start_container_engine() {
    # TODO why is --path option required for Windows
    if is_windows; then
        set - --path "$(wslpath -w "$PATH_EXECUTABLE")" "$@"
    fi
    if is_unix; then
        set - --path-management-strategy rcfiles "$@"
    fi

    rdctl start \
          --kubernetes.suppress-sudo \
          --updater=false \
          --container-engine="$RD_CONTAINER_ENGINE" \
          --kubernetes-enabled=false \
          "$@" \
          3>&-
}

start_kubernetes() {
    start_container_engine \
        --kubernetes-enabled \
        --kubernetes-version "$RD_KUBERNETES_PREV_VERSION"
}

wait_for_container_engine() {
    if using_docker; then
        # TODO: use `try` instead of an endless loop
        until docker_exe context ls -q | grep -q "^${RD_DOCKER_CONTEXT}$"; do
            sleep 3
        done
    fi
    try --max 12 --delay 10 ctrctl info
}

using_containerd() {
    test "$RD_CONTAINER_ENGINE" = "containerd"
}

using_docker() {
    ! using_containerd
}
