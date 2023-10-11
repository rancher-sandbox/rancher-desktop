delete_all_snapshots() {
    run rdctl snapshot list --json
    assert_success
    for x in $(jq_output '.name'); do
        run rdctl snapshot delete "$x"
        assert_nothing
    done
}
