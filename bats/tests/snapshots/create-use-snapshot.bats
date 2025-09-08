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
    wait_for_kubelet
    wait_for_backend
}

@test 'push an nginx pod and verify' {
    kubectl run nginx --image="$IMAGE_NGINX" --port=8080
    try --max 48 --delay 5 running_nginx
}

@test 'shutdown, make a snapshot, and run factory-reset' {
    rdctl shutdown

    snapshot_description="first snapshot"
    rdctl snapshot create "$SNAPSHOT" --description "$snapshot_description"
    run rdctl snapshot list
    assert_success
    assert_output --partial "$SNAPSHOT"
    assert_output --partial "$snapshot_description"

    rdctl factory-reset
}

@test 'startup, verify using new settings' {
    RD_CONTAINER_ENGINE=containerd
    start_kubernetes
    wait_for_container_engine
    wait_for_kubelet
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
    wait_for_kubelet

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
        assert_output --partial "Error: failed to $action snapshot \"the-nomadic-pond\": can't find snapshot \"the-nomadic-pond\""

        run rdctl snapshot "$action" 'the-nomadic-pond' --json
        assert_failure
        run jq_output '.error'
        assert_success
        assert_output "failed to $action snapshot \"the-nomadic-pond\": can't find snapshot \"the-nomadic-pond\""
    done
}

@test "attempt to create a snapshot with an existing name is flagged and doesn't do factory-reset" {
    # Shutdown RD for faster snapshot creation
    # Also verify that the failed creation doesn't trigger a factory-reset and remove settings.json
    rdctl shutdown
    assert_exists "$PATH_CONFIG_FILE"
    run rdctl snapshot create "$SNAPSHOT" --json
    assert_failure
    run jq_output '.error'
    assert_success
    assert_output "name \"$SNAPSHOT\" already exists"
    assert_exists "$PATH_CONFIG_FILE"
}

@test 'rejects attempts to create a snapshot with different description sources' {
    run rdctl snapshot create --description abc --description-from my-sad-file my-happy-snapshot-2
    assert_failure
    assert_output --partial "Error: can't specify more than one option from \"--description\" and \"--description-from\""
}

@test 'can create a snapshot where proposed name is a current ID' {
    run ls -1 "$PATH_SNAPSHOTS"
    assert_success
    refute_output ""
    snapshot_id="${lines[0]}"
    test -n "$snapshot_id"
    snapshot_description="second snapshot made with the --description option with \\ and \" and '."

    rdctl snapshot create "$snapshot_id" --description "$snapshot_description"
    run rdctl snapshot list --json
    assert_success
    run jq_output "select(.name == \"$snapshot_id\").description"
    assert_success
    assert_output "$snapshot_description"

    # And we can delete that snapshot
    run rdctl snapshot delete "$snapshot_id" --json
    assert_success
    assert_output ""
}

@test 'very long descriptions are truncated in the table view' {
    snapshot_name=armadillo_farm
    description_part="very long description names are truncated in the table view"
    long_description="$description_part, repeat: $description_part"

    rdctl snapshot create "$snapshot_name" --description "$long_description"

    run rdctl snapshot list --json
    assert_success
    run jq_output "select(.name == \"$snapshot_name\").description"
    assert_success
    assert_output "$long_description"

    run rdctl snapshot list
    assert_success
    run grep "$snapshot_name" <<<"$output"
    assert_success
    # Shouldn't have the whole description, but part of it
    refute_output --partial "$long_description"
    assert_output --partial "$description_part"
}

@test 'table view truncates descriptions at an internal newline' {
    snapshot_name=retinal_asparagus
    newline=$'\n'
    part1="there's a new"
    description="${part1}${newline}line somewhere in this description"

    rdctl snapshot create "$snapshot_name" --description "$description"

    run rdctl snapshot list --json
    assert_success
    run jq_output "select(.name == \"$snapshot_name\").description"
    assert_success
    assert_output "$description"

    run rdctl snapshot list
    assert_success
    run grep "$snapshot_name" <<<"$output"
    assert_success
    # Shouldn't have the whole description, but part of it
    refute_output --partial "$description"
    assert_output --partial "${part1}…"
}

@test "factory-reset doesn't delete a non-empty snapshots directory" {
    rdctl factory-reset
    assert_exists "$PATH_SNAPSHOTS"
}

@test 'factory-reset does delete an empty snapshots directory' {
    delete_all_snapshots
    rdctl factory-reset
    assert_not_exists "$PATH_SNAPSHOTS"
}

running_nginx() {
    run kubectl get pods -A
    assert_success
    assert_output --regexp 'default.*nginx.*Running'
}
