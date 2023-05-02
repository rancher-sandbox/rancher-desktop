# Test case 20

load '../helpers/load'
RD_CONTAINER_ENGINE=moby

switch_container_engine() {
    local name=$1
    RD_CONTAINER_ENGINE="${name}"
    rdctl set --container-engine.name="${name}"
    wait_for_container_engine
}

pull_containers() {
    ctrctl run -d -p 8085:80 --restart=no nginx
    ctrctl run -d --restart=always busybox /bin/sh -c "sleep inf"
    run ctrctl ps --format '{{json .Image}}'
    assert_output --partial nginx
    assert_output --partial busybox
}

@test 'factory reset' {
    factory_reset
}

@test 'start moby and pull nginx' {
    start_container_engine
    wait_for_container_engine
    pull_containers
}

@test "switch to containerd" {
    switch_container_engine containerd
    pull_containers
}

verify_post_switch_containers() {
    run ctrctl ps --format '{{json .Image}}'
    assert_output --partial "busybox"
    refute_output --partial "nginx"
}

switch_back_verify_post_switch_containers() {
    local name=$1
    switch_container_engine "${name}"
    try --max 12 --delay 5 verify_post_switch_containers
    assert_success
}

@test 'switch back to moby and verify containers' {
    switch_back_verify_post_switch_containers moby
}

@test 'switch back to containerd and verify containers' {
    switch_back_verify_post_switch_containers containerd
}
