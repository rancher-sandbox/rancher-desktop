wait_for_shell() {
    if is_unix; then
        try --max 24 --delay 5 rdctl shell test -f /var/run/lima-boot-done
        # wait until sshfs mounts are done
        try --max 12 --delay 5 rdctl shell test -d "$HOME/.rd"
    fi
    rdctl shell sync
}

factory_reset() {
    rdctl factory-reset --verbose

    if is_windows; then
        run sudo ip link delete docker0
        run sudo ip link delete nerdctl0

        sudo iptables -F
        sudo iptables -L | awk '/^Chain CNI/ {print $2}' | xargs -l sudo iptables -X
    fi
}

start_container_engine() {
    # TODO why is --path option required for Windows
    if is_windows; then
        set - --path "$(wslpath -w "$PATH_EXECUTABLE")" "$@"
    fi
    if is_unix; then
        set - --application.admin-access=false "$@"
        set - --application.path-management-strategy rcfiles "$@"
    fi

    # TODO containerEngine.allowedImages.patterns and WSL.integrations
    # TODO cannot be set from the commandline yet
    image_allow_list="$(bool "$RD_USE_IMAGE_ALLOW_LIST")"
    wsl_integrations="{}"
    if is_windows; then
        wsl_integrations="{\"$WSL_DISTRO_NAME\":true}"
    fi
    mkdir -p "$PATH_CONFIG"
    cat <<EOF >"$PATH_CONFIG_FILE"
{
  "version": 6,
  "WSL": { "integrations": $wsl_integrations },
  "containerEngine": {
    "allowedImages": {
      "enabled": $image_allow_list,
      "patterns": ["docker.io"]
    }
  }
}
EOF

    # Detach `rdctl start` because on Windows the process may not exit until
    # Rancher Desktop itself quits.
    rdctl start \
        --application.updater.enabled=false \
        --container-engine="$RD_CONTAINER_ENGINE" \
        --kubernetes-enabled=false \
        --virtual-machine.memory-in-gb 6 \
        "$@" &
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
    assert_line "$RD_DOCKER_CONTEXT"
}

buildkitd_is_running() {
    run rdctl shell rc-service buildkitd status
    assert_success
    assert_output --partial 'status: started'
}

wait_for_container_engine() {
    try --max 12 --delay 10 container_engine_info
    if using_docker; then
        try --max 30 --delay 5 docker_context_exists
    else
        try --max 30 --delay 5 buildkitd_is_running
    fi
}

using_containerd() {
    test "$RD_CONTAINER_ENGINE" = "containerd"
}

using_docker() {
    ! using_containerd
}
