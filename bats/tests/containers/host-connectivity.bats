# Test case 36
# On Windows, You need to create a firewall rule to allow allow communication
# between the host and the container. Please check the below link for instructions.
# https://docs.rancherdesktop.io/faq#q-can-containers-reach-back-to-host-services-via-hostdockerinternal

load '../helpers/load'

@test 'factory reset' {
    factory_reset
}

@test 'start container engine' {
    start_container_engine
    wait_for_container_engine
}

verify_host_connectivity() {
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
