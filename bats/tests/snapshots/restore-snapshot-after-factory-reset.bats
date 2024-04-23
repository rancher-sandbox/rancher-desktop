load '../helpers/load'

local_setup() {
    SNAPSHOT=some-test-snapshot-name
}

@test 'factory reset and delete all the snapshots' {
    delete_all_snapshots
    factory_reset
}

@test 'start up using containerd' {
    # TODO TODO TODO
    # Using the container engine name to check if a snapshot has been
    # restored is one of the worst possible choices, as the engine choice
    # is built into so much logic in the helper functions.
    # Maybe pull an image and verify the image is still there after the
    # restore.
    # TODO TODO TODO
    RD_CONTAINER_ENGINE=containerd
    start_kubernetes
    wait_for_container_engine
    wait_for_kubelet
    wait_for_backend
}

@test 'shut down and make a snapshot' {
    rdctl shutdown
    rdctl snapshot create "$SNAPSHOT"
    run rdctl snapshot list
    assert_success
    assert_output --partial "$SNAPSHOT"
}

@test 'do a factory reset' {
    rdctl factory-reset
}

@test 'restore the snapshot without starting up first' {
    run rdctl snapshot restore "$SNAPSHOT"
    assert_success
}

@test 'start back up' {
    # don't provide a --container-engine.name argument to `rdctl start`
    RD_CONTAINER_ENGINE=""
    # don't create settings.json file
    RD_USE_PROFILE=true
    start_kubernetes
    unset RD_USE_PROFILE
    # make sure we are not waiting for the docker context to be created
    RD_CONTAINER_ENGINE="containerd"
    wait_for_container_engine
    wait_for_kubelet
    wait_for_backend
}

@test 'verify that we are running containerd' {
    run rdctl api /settings
    assert_success
    run jq_output .containerEngine.name
    assert_success
    assert_output --partial containerd
}

@test 'delete the snapshot and verify there are no others' {
    rdctl snapshot delete "$SNAPSHOT"
    run rdctl snapshot list --json
    assert_success
    assert_output ''
}
