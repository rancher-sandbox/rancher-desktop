# bats file_tags=opensuse

load '../helpers/load'

@test 'factory reset' {
    factory_reset
}

@test 'start container engine' {
    start_container_engine
    wait_for_container_engine
}

run_container_with_published_port() {
    ctrctl pull --quiet "$IMAGE_NGINX"
    ctrctl run -d -p "$@" --restart=no "$IMAGE_NGINX"
}

verify_container_published_port() {
    run try --max 9 --delay 10 curl --insecure --verbose --show-error "$@"
    assert_success
    assert_output --partial 'Welcome to nginx!'
}

@test 'container published port binding to localhost' {
    run_container_with_published_port "127.0.0.1:8080:80"
    verify_container_published_port "http://127.0.0.1:8080"
}

@test 'container published port binding to localhost should not be accessible via 0.0.0.0' {
    skip_unless_host_ip
    run curl --verbose --head "http://${HOST_IP}:8080"
    assert_output --partial "curl: (7) Failed to connect"
}

@test 'container published port binding to 0.0.0.0' {
    skip_unless_host_ip
    run_container_with_published_port "8081:80"
    verify_container_published_port "http://${HOST_IP}:8081"
}

ip_to_int() { # <dotted-quad>
    local IFS=.
    local octets
    read -r -a octets <<<"$1"
    echo $(((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]))
}

ip_in_subnet() { # <ip> <cidr>
    local ip
    ip=$(ip_to_int "$1")
    local net
    net=$(ip_to_int "${2%/*}")
    local mask=$(((0xffffffff << (32 - ${2#*/})) & 0xffffffff))
    (((ip & mask) == (net & mask)))
}

@test 'container published port on a network that contains HOST_IP' {
    skip_unless_host_ip
    # host-switch must connect into the VM from its own gateway address. If it
    # connected from HOST_IP, the VM would treat the client as part of this
    # network, and the connection would fail.
    # Reuse the default network when it contains HOST_IP, because moby refuses
    # to create a network whose subnet overlaps it.
    network=bridge
    run -0 ctrctl network inspect "${network}" --format '{{(index .IPAM.Config 0).Subnet}}'
    if ! ip_in_subnet "${HOST_IP}" "${output}"; then
        network=host-ip-net
        ctrctl network create --subnet "${HOST_IP%.*}.0/24" --gateway "${HOST_IP}" "${network}"
    fi
    run_container_with_published_port "8082:80" --network "${network}"
    verify_container_published_port "http://${HOST_IP}:8082"
}
