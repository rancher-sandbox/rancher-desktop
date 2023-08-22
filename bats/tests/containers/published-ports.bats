load '../helpers/load'

skip_unless_host_ip() {
    if using_windows_exe; then
        HOST_IP=$(netsh.exe interface ip show addresses 'vEthernet (WSL)' | grep -Po 'IP Address:\s+\K[\d.]+')
    else
        # TODO determine if the Lima VM has its own IP address
        HOST_IP=""
    fi
    if [[ -z $HOST_IP ]]; then
        skip "Test requires a routable host ip address"
    fi
}

@test 'factory reset' {
    factory_reset
}

@test 'start container engine' {
    start_container_engine
    wait_for_container_engine
}

run_container_with_published_port() {
    local container_image="nginx"
    ctrctl pull "$container_image"
    ctrctl run -d -p "$@" --restart=no "$container_image"
}

verify_container_published_port() {
    run try --max 9 --delay 10 curl --insecure --silent --show-error "$@"
    assert_success
    assert_output --partial 'Welcome to nginx!'
}

@test 'container published port binding on localhost' {
    run_container_with_published_port "127.0.0.1:8080:80"
    verify_container_published_port "http://127.0.0.1:8080"
}

@test 'container published port binding on 0.0.0.0' {
    skip_unless_host_ip
    run_container_with_published_port "8081:80"
    verify_container_published_port "http://$HOST_IP:8081"
}
