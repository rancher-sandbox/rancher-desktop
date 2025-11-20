# bats file_tags=opensuse

load '../helpers/load'

LOCALHOST="127.0.0.1"

local_setup() {
    if ! is_windows; then
        skip "The test doesn't work on non-Windows platforms"
    fi
}

@test 'factory reset' {
    factory_reset
}

@test 'start container engine' {
    start_container_engine
    wait_for_container_engine
}

run_container_with_host_network_driver() {
    local image="python:slim"
    ctrctl pull --quiet "$image"
    ctrctl run -d --network=host --restart=no "$image" "$@"
}

verify_container_port() {
    run try --max 9 --delay 10 curl --insecure --verbose --show-error "$@"
    assert_success
    assert_output --partial 'Directory listing for'
}

@test 'process is bound to 0.0.0.0 using host network driver' {
    local container_port="8010"
    run_container_with_host_network_driver python -m http.server "$container_port"
    verify_container_port "http://$LOCALHOST:$container_port"
    skip_unless_host_ip
    verify_container_port "http://${HOST_IP}:$container_port"
}

@test 'process is bound to 127.0.0.1 using host network driver' {
    local container_port="8016"
    run_container_with_host_network_driver python -m http.server $container_port --bind "$LOCALHOST"
    verify_container_port "http://$LOCALHOST:$container_port"
    skip_unless_host_ip
    run curl --verbose --head "http://${HOST_IP}:$container_port"
    assert_output --partial "curl: (7) Failed to connect"
}
