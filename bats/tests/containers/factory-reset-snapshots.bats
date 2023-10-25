load '../helpers/load'

@test 'factory reset' {
    delete_all_snapshots
    factory_reset
}

@test 'Start up Rancher Desktop with a snapshots subdirectory' {
    start_container_engine
    wait_for_container_engine
    wait_for_backend
}

@test "Verify the snapshot dir isn't deleted on factory-reset" {
    rdctl shutdown
    rdctl snapshot create shortlived-snapshot
    rdctl factory-reset
    assert_not_exists "$PATH_APP_HOME/rd-engine.json"
    assert_exists "$PATH_SNAPSHOTS"
    run ls -A "$PATH_SNAPSHOTS"
    assert_output
    test -n "$output"
}

@test 'Verify factory-reset deletes an empty snapshots directory' {
    rdctl snapshot delete shortlived-snapshot
    rdctl factory-reset
    assert_not_exists "$PATH_APP_HOME"
}
