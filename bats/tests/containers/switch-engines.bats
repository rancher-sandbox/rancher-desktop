# Test case 20

setup() {
    load '../helpers/load'
    RD_CONTAINER_ENGINE=moby
}

teardown_file() {
    load '../helpers/load'
    run rdctl shutdown
    assert_nothing
}

switch_container_engine() {
    local name=$1
    RD_CONTAINER_ENGINE="${name}"
    run rdctl set --container-engine.name="${name}"
    assert_success
    wait_for_container_engine
}

pull_nginx() {
    ctrctl run -d -p 8085:80 --restart=no nginx
    run ctrctl ps --format '{{json .Image}}'
    assert_output --partial nginx
}

@test 'factory reset' {
    factory_reset
}

@test 'start moby and pull nginx' {
    start_container_engine
    wait_for_container_engine
    pull_nginx
}

@test "switch to containerd" {
    switch_container_engine containerd
    pull_nginx
}

switch_back_verify_nginx_gone() {
    local name=$1
    switch_container_engine "${name}"
    run ctrctl ps --format '{{json .Image}}'
    refute_output --partial "nginx"
}

@test 'switch back to moby' {
    switch_back_verify_nginx_gone moby
}

@test 'switch back to containerd and verify that the nginx container is gone' {
    switch_back_verify_nginx_gone containerd
}
