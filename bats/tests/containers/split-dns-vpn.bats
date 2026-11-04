# bats file_tags=opensuse

load '../helpers/load'

REGISTRY_URL=$(echo "$RD_VPN_TEST_IMAGE" | cut -d'/' -f1)

local_setup() {
    if ! using_vpn_test_image; then
        skip "This test requires a connection to the designated VPN."
    fi
}

@test 'factory reset' {
    factory_reset
}

@test 'start container engine' {
    start_container_engine
    wait_for_container_engine
}

@test 'Can access private registry over VPN from host' {
    run curl -I -k "https://$REGISTRY_URL/v2"
    assert_success
    # We avoid assert_line here due to the trailing carriage return (\r) issues.
    assert_output --partial "docker-distribution-api-version: registry/2.0"
}

@test 'Can pull image from private registry over VPN' {
    run ctrctl pull --quiet "$RD_VPN_TEST_IMAGE"
    assert_success
}

@test 'Can verify container access to the registry' {
    run ctrctl run --rm "$IMAGE_NGINX" curl -I -k "https://$REGISTRY_URL/v2"
    assert_success
    assert_output --partial "docker-distribution-api-version: registry/2.0"
}

@test 'Verify that a container can ping host.rancher-desktop.internal when the VPN is enabled' {
    run ctrctl run --rm "$IMAGE_BUSYBOX" timeout -s INT 10 ping -c 5 host.rancher-desktop.internal
    assert_success
    assert_output --partial "5 packets transmitted, 5 packets received, 0% packet loss"
}
