load '../helpers/load'

local_setup() {
    if is_windows; then
        skip "snapshots test not applicable on Windows"
    fi
    SNAPSHOT=the-ubiquitous-flounder
}

@test 'factory reset and delete all the snapshots' {
    delete_all_snapshots
    factory_reset
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
    rdctl shutdown
    run rdctl snapshot restore "$SNAPSHOT"
    assert_success
    refute_output --partial $"failed to restore snapshot \"$SNAPSHOT\""

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

@test 'verify identification errors' {
    run rdctl snapshot restore 'the-nomadic-pond'
    assert_failure
    assert_output --partial $"Error: can't restore snapshot: can't find a snapshot with name or ID \"the-nomadic-pond\""
    run rdctl snapshot restore 'the-nomadic-pond' --json
    assert_failure
    run jq_output '.error'
    assert_success
    assert_output --partial $"can't restore snapshot: can't find a snapshot with name or ID \"the-nomadic-pond\""
    run rdctl snapshot delete 'the-nomadic-pond'
    assert_failure
    assert_output --partial $"Error: can't delete snapshot: can't find a snapshot with name or ID \"the-nomadic-pond\""
    run rdctl snapshot delete 'the-nomadic-pond' --json
    assert_failure
    run jq_output '.error'
    assert_success
    assert_output $"can't delete snapshot: can't find a snapshot with name or ID \"the-nomadic-pond\""
}

@test 'delete all the snapshots' {
    rdctl snapshot delete "$SNAPSHOT"
    run rdctl snapshot list --json
    assert_success
    assert_output ''
}

running_nginx() {
    run kubectl get pods -A
    assert_success
    assert_output --regexp 'default.*nginx.*Running'
}
