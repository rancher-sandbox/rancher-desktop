load '../helpers/load'

local_setup() {
    if is_windows; then
        skip "snapshots test not applicable on Windows"
    fi
}

@test 'delete all the snapshots' {
    # There's no need to run factory-reset here because this test
    # just tests `rdctl snapshot list and create`
    delete_all_snapshots
}

@test 'verify snapshot-list output' {
    run rdctl snapshot create cows_fish_capers
    assert_success
    sleep 5
    run rdctl snapshot create world-buffalo-federation
    assert_success
    sleep 5
    run rdctl snapshot create run-like-an-antelope
    assert_success
    run rdctl snapshot list
    assert_success
    assert_output --partial " cows_fish_capers "
    assert_output --partial " world-buffalo-federation "
    assert_output --partial " run-like-an-antelope "
    run rdctl snapshot list --json --utc
    assert_success
    ID0=$(jq_output '.[0].ID')
    ID1=$(jq_output '.[1].ID')
    ID2=$(jq_output '.[2].ID')
    DATE1="$(jq_output '.[1].created')"
    DATE2="$(jq_output '.[2].created')"
    if is_macos; then
        TIME1=$(date -jf "%Y-%m-%dT%H:%M:%SZ" "$DATE1" +%s)
        TIME2=$(date -jf "%Y-%m-%dT%H:%M:%SZ" "$DATE2" +%s)
    elif is_linux; then
        TIME1=$(date --date="$DATE1" +%s)
        TIME2=$(date --date="$DATE2" +%s)
    fi
    ((TIME2 - TIME1 > 4))
    # This is all we can assert, because we don't have an upper bound for the time
    # between the two `snapshot create's`
    run rdctl snapshot list
    assert_success
    assert_output --regexp "${ID0}.*cows_fish_capers"
    assert_output --regexp "${ID1}.*world-buffalo-federation"
    assert_output --regexp "${ID2}.*run-like-an-antelope"
}
