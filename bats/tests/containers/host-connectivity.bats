# Test case 36
# On Windows, You need to create a firewall rule to allow communication
# between the host and the container. Please check the below link for instructions.
# https://docs.rancherdesktop.io/faq#q-can-containers-reach-back-to-host-services-via-hostdockerinternal

load '../helpers/load'

@test 'factory reset' {
    factory_reset
}

skip_on_legacy_networking() {
    if is_windows && ! using_networking_tunnel; then
        # The test also works with a firewall rule, but somehow the rule seems to
        # stop working randomly and then needs to be deleted and recreated. We are
        # not automating this just for the sake of the legacy implementation.
        skip "This test requires the new networking tunnel on Windows"
    fi
}

@test 'start container engine' {
    skip_on_legacy_networking
    start_container_engine
    wait_for_container_engine
}

verify_host_connectivity() {
    skip_on_legacy_networking
    run ctrctl run --rm alpine ping -c 5 "$1"
    assert_success
    assert_output --partial "5 packets transmitted, 5 packets received, 0% packet loss"
}

@test 'ping host.docker.internal from a container' {
    verify_host_connectivity "host.docker.internal"
}

@test 'ping host.rancher-desktop.internal from a container' {
    verify_host_connectivity "host.rancher-desktop.internal"
}
