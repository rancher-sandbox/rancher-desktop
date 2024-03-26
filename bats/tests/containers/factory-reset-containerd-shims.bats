load '../helpers/load'

BOGUS_SHIM="${PATH_CONTAINERD_SHIMS}/containerd-shim-bogus-v1"

local_setup_file() {
    RD_USE_RAMDISK=false # interferes with deleting $PATH_APP_HOME

    delete_all_snapshots
    rm -rf "$PATH_CONTAINERD_SHIMS"
}

local_teardown_file() {
    rm -rf "$PATH_CONTAINERD_SHIMS"
}

@test 'factory reset' {
    # On Windows the cache directory is under PATH_APP_HOME.
    factory_reset --remove-kubernetes-cache=true
    assert_not_exists "$PATH_APP_HOME"
}

@test 'factory reset will not remove any shims' {
    assert_not_exists "$PATH_CONTAINERD_SHIMS"
    create_file "$BOGUS_SHIM" <<<''
    factory_reset
    assert_exists "$BOGUS_SHIM"
    assert_exists "$PATH_APP_HOME"
}

@test 'factory reset will remove empty shim directory' {
    rm "$BOGUS_SHIM"
    factory_reset
    assert_not_exists "$PATH_CONTAINERD_SHIMS"
    assert_not_exists "$PATH_APP_HOME"
}
