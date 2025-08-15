load '../helpers/load'

local_setup_file() {
    RD_USE_RAMDISK=false # interferes with deleting $PATH_APP_HOME
}

@test 'factory reset' {
    delete_all_snapshots
    rm -rf "$PATH_CONTAINERD_SHIMS"
    # On Windows the cache directory is under PATH_APP_HOME.
    factory_reset --cache
}

@test 'Start up Rancher Desktop with a snapshots subdirectory' {
    start_container_engine
    wait_for_container_engine
    wait_for_backend
}

@test "Verify the snapshot dir isn't deleted on factory-reset" {
    rdctl shutdown
    rdctl snapshot create shortlived-snapshot
    factory_reset --cache
    assert_not_exists "$PATH_APP_HOME/rd-engine.json"
    assert_exists "$PATH_SNAPSHOTS"
    run ls -A "$PATH_SNAPSHOTS"
    assert_output
}

@test 'Verify factory-reset deletes an empty snapshots directory' {
    rdctl snapshot delete shortlived-snapshot
    factory_reset --cache
    assert_not_exists "$PATH_APP_HOME"
}
