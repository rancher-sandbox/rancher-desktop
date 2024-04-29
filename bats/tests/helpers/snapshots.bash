delete_all_snapshots() {
    run rdctl snapshot list --json
    assert_success
    # On Windows, executing native Windows executables consumes stdin.
    # https://github.com/microsoft/WSL/issues/10429
    # Therefore, we have to collect all of the names before running any `rdctl`
    # commands.  However, on macOS (bash 3.2), we seem to have issues with array
    # variables; as a workaround, do an unquoted iteration.
    run jq_output .name
    assert_success
    local name names=$output
    for name in $names; do
        rdctl snapshot delete "$name"
    done
    run rdctl snapshot list
    assert_success
    assert_output --partial 'No snapshots'
}
