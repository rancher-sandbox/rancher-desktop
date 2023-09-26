load '../helpers/load'

local_setup() {
    skip_on_windows "snapshots test not applicable on Windows"
}

@test 'factory reset and delete all the snapshots' {
    delete_all_snapshots
    factory_reset
}

# This test ensures that we have something to take a snapshot of, because appHome might not exist.
@test 'start up' {
    start_kubernetes
    wait_for_container_engine
    wait_for_apiserver
}

@test 'verify empty snapshot-list output' {
    run rdctl snapshot list --json
    assert_success
    assert_output ''

    run rdctl snapshot list
    assert_success
    assert_output 'No snapshots present.'
}

@test 'create three snapshots, allowing for restarts' {
    # Ensure the app is up and running
    wait_for_container_engine
    wait_for_apiserver
    wait_for_backend
    # Sleep 5 seconds after creating each snapshot so later we can verify
    # that the differences in each snapshot's creation time makes sense.

    rdctl snapshot create cows_fish_capers
    sleep 5
    wait_for_container_engine
    wait_for_apiserver
    wait_for_backend
    rdctl snapshot create world-buffalo-federation
    sleep 5
    wait_for_container_engine
    wait_for_apiserver
    wait_for_backend
    rdctl snapshot create run-like-an-antelope
    wait_for_container_engine
    wait_for_apiserver
    wait_for_backend
}

@test 'verify snapshot-list output with snapshots' {
    run rdctl snapshot list --json
    assert_success
    ID0=$(jq_output 'select(.name == "cows_fish_capers").id')
    ID1=$(jq_output 'select(.name == "world-buffalo-federation").id')
    ID2=$(jq_output 'select(.name == "run-like-an-antelope").id')
    DATE1=$(jq_output 'select(.name == "world-buffalo-federation").created')
    DATE2=$(jq_output 'select(.name == "run-like-an-antelope").created')
    if is_macos; then
        TIME1=$(date -jf "%Y-%m-%dT%H:%M:%S" "$DATE1" +%s 2>/dev/null)
        TIME2=$(date -jf "%Y-%m-%dT%H:%M:%S" "$DATE2" +%s 2>/dev/null)
    elif is_linux; then
        TIME1=$(date --date="$DATE1" +%s)
        TIME2=$(date --date="$DATE2" +%s)
    fi
    # This is all we can assert, because we don't have an upper bound for the time
    # between the two `snapshot create's`, and we don't have info on fractions of a second,
    # so a difference of 4.9999 could show up as 4
    ((TIME2 - TIME1 > 4))

    run rdctl snapshot list
    assert_success
    assert_output --regexp "${ID0}.* cows_fish_capers "
    assert_output --regexp "${ID1}.* world-buffalo-federation "
    assert_output --regexp "${ID2}.* run-like-an-antelope "
}

@test 'verify k8s is off' {
    run rdctl api /v1/settings
    assert_success
    run jq_output .kubernetes.enabled
    assert_success
    case $output in
    "true")
        rdctl set --kubernetes.enabled=false
        wait_for_container_engine
        wait_for_backend
        ;;
    esac
}

@test 'create a snapshot with k8s off' {
    rdctl snapshot create anime-walnut-festival
    wait_for_container_engine
    wait_for_backend
}

@test 'and verify the new snapshot is listed' {
    run rdctl snapshot list
    assert_success
    assert_output --partial anime-walnut-festival
}

@test 'and clean up' {
    delete_all_snapshots
}
