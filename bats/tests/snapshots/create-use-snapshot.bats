load '../helpers/load'

local_setup() {
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
    wait_for_backend
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
    refute_output --partial fail

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
    for action in restore delete; do
        run rdctl snapshot "$action" 'the-nomadic-pond'
        assert_failure
        assert_output "Error: can't find snapshot \"the-nomadic-pond\""

        run rdctl snapshot "$action" 'the-nomadic-pond' --json
        assert_failure
        run jq_output '.error'
        assert_success
        assert_output "can't find snapshot \"the-nomadic-pond\""
    done
}

@test 'can create a snapshot where proposed name is a current ID' {
    run ls -1 "$PATH_SNAPSHOTS"
    assert_success
    refute_output ""
    run head -n 1 <<<"$output"
    assert_success
    refute_output ""
    snapshot_id=$output
    rdctl snapshot create "$snapshot_id"
    # And we can delete that snapshot
    run rdctl snapshot delete "$snapshot_id" --json
    assert_success
    assert_output ""
}

@test "factory-reset doesn't delete a non-empty snapshots directory" {
    rdctl factory-reset
    assert_exists "$PATH_SNAPSHOTS"
}

@test 'delete all the snapshots' {
    rdctl snapshot delete "$SNAPSHOT"
    run rdctl snapshot list --json
    assert_success
    assert_output ''
}

@test 'factory-reset does delete an empty snapshots directory' {
    rdctl factory-reset
    assert_not_exists "$PATH_SNAPSHOTS"
}

running_nginx() {
    run kubectl get pods -A
    assert_success
    assert_output --regexp 'default.*nginx.*Running'
}
