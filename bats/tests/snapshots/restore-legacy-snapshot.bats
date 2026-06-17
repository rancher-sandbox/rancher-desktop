load '../helpers/load'

# Snapshots created before the Lima v2 disk-layout change store the VM disk
# under the legacy filenames "basedisk" and "diffdisk". Restoring such a
# snapshot must still work and preserve the disk contents.

local_setup() {
    skip_on_windows "Lima manages the VM disk image only on macOS and Linux"
    SNAPSHOT=legacy-disk-names
}

@test 'factory reset and delete all the snapshots' {
    delete_all_snapshots
    factory_reset
}

@test 'start the container engine' {
    start_container_engine
    wait_for_container_engine
    wait_for_backend
}

@test 'pull an image to populate the VM disk' {
    ctrctl pull "$IMAGE_BUSYBOX"
    run ctrctl image ls
    assert_success
    assert_output --partial busybox
}

@test 'shut down and create a snapshot' {
    rdctl shutdown
    rdctl snapshot create "$SNAPSHOT"
    run rdctl snapshot list
    assert_success
    assert_output --partial "$SNAPSHOT"
}

@test 'rewrite the snapshot with the legacy disk filenames' {
    # `snapshot list --json` hides the ID, so find the snapshot by its
    # directory name; only the one we just created exists at this point.
    run ls -1 "$PATH_SNAPSHOTS"
    assert_success
    assert_output # the snapshot directory must exist
    local snapshot_dir="$PATH_SNAPSHOTS/${lines[0]}"

    assert_exists "$snapshot_dir/disk"
    assert_exists "$snapshot_dir/iso"
    mv "$snapshot_dir/disk" "$snapshot_dir/diffdisk"
    mv "$snapshot_dir/iso" "$snapshot_dir/basedisk"
}

@test 'factory reset before restoring' {
    rdctl factory-reset
}

@test 'restore the legacy snapshot, restart, and verify the disk survived' {
    run rdctl snapshot restore "$SNAPSHOT"
    assert_success
    refute_output --partial fail

    launch_the_application
    wait_for_container_engine
    wait_for_backend

    run ctrctl image ls
    assert_success
    assert_output --partial busybox
}

@test 'delete the snapshot' {
    rdctl snapshot delete "$SNAPSHOT"
}
