delete_all_snapshots() {
    run rdctl snapshot list --json
    assert_success
    # On Windows, executing native Windows executables consumes stdin.
    # https://github.com/microsoft/WSL/issues/10429
    # Work around the issue by using `run` to populate `${lines[@]}` ahead of
    # time, so that we don't need the buffer during the loop.
    run jq_output .name
    assert_success
    local name
    for name in "${lines[@]}"; do
        rdctl snapshot delete "$name"
    done
    run rdctl snapshot list
    assert_success
    assert_output --partial 'No snapshots'
}
