wait_for_shell() {
    if is_unix; then
        try --max 24 --delay 5 rdctl shell test -f /var/run/lima-boot-done
        # wait until sshfs mounts are done
        try --max 12 --delay 5 rdctl shell test -d $HOME/.rd
    fi
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
        mkdir -p "$LIMA_HOME/_config"
        override="$LIMA_HOME/_config/override.yaml"
        if [ ! -f "$override" ]; then
            touch "$override"
            if [ -f "${RD_OVERRIDE:-/no such file}" ]; then
                cp "$RD_OVERRIDE" "$override"
            fi
        fi

        # hack for tests/registry/creds.bats because we can't configure additional
        # hosts via settings.yaml
        if ! grep -q registry.internal: "$override"; then
            cat <<EOF >>"$override"

hostResolver:
  hosts:
    registry.internal: 192.168.5.15
EOF
        fi
    fi

    image_allow_list="$(bool $RD_USE_IMAGE_ALLOW_LIST)"
    path_management="rcfiles"
    wsl_integrations="{}"
    if is_windows; then
        path_management="notset"
        wsl_integrations="{\"$WSL_DISTRO_NAME\":true}"
    fi

    mkdir -p "$PATH_CONFIG"
    cat <<EOF > "$PATH_CONFIG_FILE"
{
  "version": 5,
  "application": {
    "adminAccess":            false,
    "pathManagementStrategy": "$path_management",
    "updater":                { "enabled": false },
  },
  "virtualMachine": {
    "memoryInGB": 6,
  },
  "WSL": { "integrations": $wsl_integrations },
  "containerEngine": {
    "imageAllowList": {
      "enabled": $image_allow_list,
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
          --kubernetes.admin-access=false \
          --application.updater.enabled=false \
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

container_engine_info() {
    run ctrctl info
    assert_success
    assert_output --partial "Server Version:"
}

docker_context_exists() {
    run docker_exe context ls -q
    assert_success
    assert_line $RD_DOCKER_CONTEXT
}

wait_for_container_engine() {
    try --max 12 --delay 10 container_engine_info
    if using_docker; then
        try --max 30 --delay 5 docker_context_exists
    fi
}

using_containerd() {
    test "$RD_CONTAINER_ENGINE" = "containerd"
}

using_docker() {
    ! using_containerd
}
