delete_all_snapshots() {
    run rdctl snapshot list --json
    assert_success
    jq_output .name | while IFS= read -r name; do
        run rdctl snapshot delete "$name"
        assert_success
    done
}
