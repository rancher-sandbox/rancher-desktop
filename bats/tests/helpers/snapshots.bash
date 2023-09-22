get_snapshot_id_from_name() {
    local name=$1
    run rdctl snapshot list
    assert_success
    # shellcheck disable=SC2086 # dollar-1 belongs to awk, not bash
    run awk /"$name"'/ { print $1 }' <<<"$output"
    assert_success
    echo "$output"
}
