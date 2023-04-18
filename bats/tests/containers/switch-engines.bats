# Test case 20

setup() {
    load '../helpers/load'
    RD_CONTAINER_ENGINE=moby
}

@test 'factory reset' {
    factory_reset
}

@test 'start container engine' {
    start_container_engine
    wait_for_container_engine
}

@test "pull nginx" {
    docker run -d -p 8085:80 --restart=no nginx
    run docker ps --format '{{json .Image}}'
    assert_output --partial nginx
}

@test "switch to containerd" {
    RD_CONTAINER_ENGINE=containerd
    run rdctl set --container-engine.name=containerd
    assert_success
    wait_for_container_engine
    nerdctl run -d -p 8086:80 --restart=no nginx
    run nerdctl ps --format '{{json .Image}}'
    assert_output --partial nginx
}

@test 'switch back to moby' {
    RD_CONTAINER_ENGINE=moby
    run rdctl set --container-engine.name moby
    assert_success
    wait_for_container_engine
}

@test 'verify the nginx container is gone' {
    run docker ps --format '{{json .Image}}'
    refute_output --partial "nginx"
}

@test 'switch back to containerd and verify that the nginx container is gone' {
    RD_CONTAINER_ENGINE=containerd
    run rdctl set --container-engine.name containerd
    assert_success
    wait_for_container_engine
    run nerdctl ps --format '{{json .Image}}'
    refute_output --partial "nginx"
}

@test 'linux-bats is waiting for an rd shutdown before it stops' {
    rdctl shutdown
}
