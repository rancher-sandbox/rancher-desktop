load '../helpers/load'

@test 'snapshot shows up in general help' {
    run rdctl --help
    assert_success
    assert_output -partial snapshot
}

@test 'disallows spaces in snapshot names' {
    run rdctl snapshot create "space not allowed in snapshot name"
    assert_failure
}

@test 'rejects overlong snapshot name' {
    long_name=$(head -n 4 </dev/random | base64 | cut -b 1-120)
    run rdctl snapshot create "$long_name"
    assert_failure
}

@test 'complain about missing argument' {
    for arg in create restore delete; do
        run rdctl snapshot "$arg"
        assert_failure
    done
}

@test 'disallows special characters in snapshot names' {
    for c in '!' '$' '^' '&' '*' '(' ')' '[' ']' '{' '}' ';' ':' '?' '/' "'" '"' '`'; do
        run rdctl snapshot create "bad-char-${c}"
        assert_failure
        assert_output --partial "$c"
    done
}

@test 'fails to create duplicate snapshots' {
    run rdctl snapshot create testing--no-dups-allowed
    assert_success
    run rdctl snapshot create testing--no-dups-allowed
    assert_failure
}

@test 'cleanup duplicate testing snapshot' {
    run get_snapshot_id_from_name testing--no-dups-allowed
    assert_success
    orig_id="$output"
    rdctl snapshot delete "$orig_id"
}

@test 'complain about restoring non-existent snapshot' {
    run rdctl snapshot restore 'not a snapshot'
    assert_failure
    assert_output --partial 'snapshot with id "not a snapshot" does not exist'
}

@test 'complain about deleting non-existent snapshot' {
    run rdctl snapshot delete 'not a snapshot'
    assert_failure
    assert_output --partial 'snapshot with id "not a snapshot" does not exist'
}
