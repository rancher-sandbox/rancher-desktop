load '../helpers/load'

@test 'factory reset' {
    factory_reset
}

build_alpine_socat_image() {
    cat <<EOF | docker build -t socat-udp-test -f- .
FROM ${IMAGE_ALPINE}
RUN apk add --no-cache socat
CMD ["sh", "-c", "socat -v -T1 UDP-RECVFROM:\${PORT},fork STDOUT"]
EOF
}

@test 'start container engine' {
    start_container_engine
    wait_for_container_engine
    build_alpine_socat_image
}

run_container_with_published_udp_port_and_connect() {
    local ip=$1
    local port=$2
    local netcat_connect_addr=$3
    ctrctl run -d --name socat-udp-"$port" -p "$ip":"$port":"$port"/udp --env PORT="$port" socat-udp-test
    run try --max 10 --delay 10 nc -u -w1 "$netcat_connect_addr" "$port" <<<"hello from nc UDP port $port"
    assert_success
    run ctrctl logs socat-udp-"$port"
    assert_success
}

@test 'container published UDP port binding to localhost' {
    port=$(shuf -i 20000-30000 -n 1)
    run_container_with_published_udp_port_and_connect "127.0.0.1" "$port" "127.0.0.1"
    assert_output --partial "hello from nc UDP port $port"
}

@test 'container published port binding to localhost should not be accessible via non localhost' {
    port=$(shuf -i 20000-30000 -n 1)
    skip_unless_host_ip
    run_container_with_published_udp_port_and_connect "127.0.0.1" "$port" "${HOST_IP}"
    refute_output --partial "hello from nc UDP port $port"
}

@test 'container published UDP port binding to 0.0.0.0' {
    port=$(shuf -i 20000-30000 -n 1)
    skip_unless_host_ip
    run_container_with_published_udp_port_and_connect "0.0.0.0" "$port" "${HOST_IP}"
    assert_output --partial "hello from nc UDP port $port"
}
