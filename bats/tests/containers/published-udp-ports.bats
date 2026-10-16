# The suite runs inside a WSL distro, and HOST_IP is the host's
# `vEthernet (WSL)` address, so 'binding to 0.0.0.0' sends the datagram
# across the WSL NAT to host-switch.exe on the host.  Whether it arrives
# depends on a firewall exception for host-switch.exe that permits UDP on the
# profile the traffic arrives on.  The first test checks the protocol and
# records the network categories.  The 'binding to localhost' case never
# leaves the distro: wsl-proxy answers it, so it passes even when the
# exception is wrong.
load '../helpers/load'

local_setup() {
    skip_on_unix
}

powershell_output() { # <script>
    # errexit is in effect, and a failing powershell.exe must not abort the
    # test before it can report what it found.
    powershell.exe -NoProfile -Command "$1" 2>&1 || :
}

@test 'the firewall exception permits UDP' {
    if ! using_windows_exe; then
        skip "The host firewall only governs traffic leaving the WSL distro"
    fi
    if [[ $RD_LOCATION != "system" ]]; then
        skip "Only a machine-wide install creates the exception"
    fi
    # Record what the runner gives us, so a change of network category shows
    # up here rather than as a datagram that silently never arrives.
    # shellcheck disable=SC2016 # the $() are PowerShell, not shell
    trace "network categories: $(powershell_output 'Get-NetConnectionProfile | ForEach-Object { "$($_.InterfaceAlias)=$($_.NetworkCategory)" }')"

    run powershell_output "Get-NetFirewallRule -DisplayName 'Rancher Desktop Networking*' | ForEach-Object { \"\$(\$_.DisplayName): \$((\$_ | Get-NetFirewallPortFilter).Protocol) \$(\$_.Profile)\" }"
    trace "firewall rules: ${output//$'\n'/ | }"
    # build/wix/main.wxs creates these two, and omitting Protocol leaves them
    # at any.  A tcp-only exception drops every published UDP port.
    assert_line --regexp 'Rancher Desktop Networking Private Exception: Any '
    assert_line --regexp 'Rancher Desktop Networking Domain Exception: Any '
    refute_output --regexp 'Rancher Desktop Networking.*: *TCP'
}

@test 'factory reset' {
    factory_reset
}

build_alpine_socat_image() {
    cat <<EOF | ctrctl build -t socat-udp-test -f- .
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
