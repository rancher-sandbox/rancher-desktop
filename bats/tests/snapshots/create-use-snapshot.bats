load '../helpers/load'

# Hey Jan: why does this keep changing?
SNAPSHOT="$(basename "$(mktemp -u -t moby.XXXXX)")"
SNAPSHOT=moby-nginx-snapshot01

local_setup() {
    if is_windows; then
        skip "snapshots test not applicable on Windows"
    fi
}

@test 'factory reset' {
    factory_reset
}

@test 'start up in moby' {
    RD_CONTAINER_ENGINE=moby
    start_kubernetes
    wait_for_container_engine
    wait_for_apiserver
}

start_nginx() {
    run kubectl get pods
    assert_output --regexp 'nginx.*Running'
}

running_nginx() {
    run kubectl get pods -A
    assert_success
    assert_output --regexp 'default.*nginx.*Running'
}

@test 'push an nginx pod and verify' {
    kubectl run nginx --image=nginx:latest --port=8080
    try --max 48 --delay 5 running_nginx
    # TODO: hit the nginx container with curl
}

@test 'shutdown, make a snapshot, and clear everything' {
    rdctl shutdown
    rdctl snapshot create "$SNAPSHOT"
    run rdctl snapshot list
    assert_output --partial "$SNAPSHOT"
    rdctl factory-reset
}

@test 'startup, verify using new defaults' {
    RD_CONTAINER_ENGINE=containerd
    start_kubernetes
    wait_for_container_engine
    wait_for_apiserver
    run rdctl api /settings
    assert_success
    run jq_output .containerEngine.name
    assert_success
    assert_output --partial containerd
    run kubectl get pods -A
    assert_success
    refute_output --regexp 'default.*nginx.*Running'
}

@test 'shutdown and restore' {
    rdctl shutdown
    run get_snapshot_id_from_name "$SNAPSHOT"
    assert_success
    rdctl snapshot restore "$output"
}

@test 'restart and verify snapshot state' {
    # Circumvent having start_kubernetes => start_container_engine set all the defaults

    if using_dev_mode; then
        # translate args back into the internal API format
        yarn dev --no-modal-dialogs
    else
        RD_TEST=bats rdctl start --no-modal-dialogs &
    fi

    # Keep this variable in sync with
    RD_CONTAINER_ENGINE=moby
    wait_for_container_engine
    wait_for_apiserver
    run rdctl api /settings
    assert_success
    run jq_output
    assert_success
    assert_output --partial moby
    kubectl get pods -A
    assert_output --regexp 'default.*nginx.*Running'
}
