# bats file_tags=opensuse

load '../helpers/load'

@test 'factory reset' {
    factory_reset
}

@test 'start container engine' {
    start_container_engine
    wait_for_container_engine
}

verify_host_connectivity() {
    run ctrctl run --rm "$IMAGE_BUSYBOX" timeout -s INT 10 ping -c 5 "$1"
    assert_success
    assert_output --partial "5 packets transmitted, 5 packets received, 0% packet loss"
}

# Some networks drop pings, so the test can only pass where the host itself
# gets a reply.
skip_unless_network_allows_ping() {
    local address=$1
    local -a ping_once
    if is_windows; then
        ping_once=(ping.exe -n 1 -w 5000 "$address")
    elif is_macos; then
        ping_once=(ping -c 1 -t 5 "$address")
    else
        ping_once=(ping -c 1 -W 5 "$address")
    fi
    if ! "${ping_once[@]}" >/dev/null; then
        skip "The host itself cannot ping $address"
    fi
}

@test 'ping an external address from a container' {
    skip_unless_network_allows_ping 1.1.1.1
    verify_host_connectivity 1.1.1.1
}

@test 'ping host.docker.internal from a container' {
    skip_unless_host_answers_ping
    verify_host_connectivity "host.docker.internal"
}

@test 'ping host.rancher-desktop.internal from a container' {
    skip_unless_host_answers_ping
    verify_host_connectivity "host.rancher-desktop.internal"
}
