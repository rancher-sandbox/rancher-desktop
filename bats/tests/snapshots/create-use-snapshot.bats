load '../helpers/load'

local_setup() {
    if is_windows; then
        skip "snapshots test not applicable on Windows"
    fi
    SNAPSHOT=moby-nginx-snapshot01
}

@test 'factory reset and delete the snapshot if it exists' {
    factory_reset
    run get_snapshot_id_from_name "$SNAPSHOT"
    assert_success
    if [[ -n $output ]]; then
        rdctl snapshot delete "$output"
    fi
}

@test 'start up in moby' {
    RD_CONTAINER_ENGINE=moby
    start_kubernetes
    wait_for_container_engine
    wait_for_apiserver
}

@test 'push an nginx pod and verify' {
    kubectl run nginx --image=nginx:latest --port=8080
    try --max 48 --delay 5 running_nginx
}

@test 'shutdown, make a snapshot, and clear everything' {
    rdctl shutdown
    rdctl snapshot create "$SNAPSHOT"
    run rdctl snapshot list
    assert_success
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

# This should be one long test because if `snapshot restore` fails there's no point starting up
@test 'shutdown, restore, restart and verify snapshot state' {
    local snapshotID
    rdctl shutdown
    run get_snapshot_id_from_name "$SNAPSHOT"
    assert_success
    refute_output ""
    snapshotID="$output"
    run rdctl snapshot restore "$snapshotID"
    assert_success
    refute_output --partial $"failed to restore snapshot \"$snapshotID\""

    launch_the_application

    # Keep this variable in sync with the current setting so the wait_for commands work
    RD_CONTAINER_ENGINE=moby
    wait_for_container_engine
    wait_for_apiserver
    run rdctl api /settings
    assert_success
    run jq_output .containerEngine.name
    assert_success
    assert_output moby
    try --max 48 --delay 5 running_nginx
}

running_nginx() {
    run kubectl get pods -A
    assert_success
    assert_output --regexp 'default.*nginx.*Running'
}
