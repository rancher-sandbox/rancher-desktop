load '../helpers/load'

@test 'factory reset' {
    factory_reset
}

@test 'invalid k8s version' {
    start_kubernetes --kubernetes.version=moose
    wait_for_container_engine
    # Can't use wait_for_api_server because it hard-wires a valid k8s version and we're specifying an invalid one here.
    # and we're specifying an invalid one here
    local timeout="$(($(date +%s) + 10 * 60))"
    until kubectl get --raw /readyz &>/dev/null; do
        assert [ "$(date +%s)" -lt "$timeout" ]
        sleep 1
    done
    # No way there's a race-condition here.
    # The version was checked and written to the log file before starting k8s,
    # and we have to wait a few minutes before k8s is ready and we're at the next line.
    assert_file_contains "$PATH_LOGS/kube.log" "Requested kubernetes version 'moose' is not a supported version. Falling back to"
}

# on macOS it still hangs without this
@test 'shutdown' {
    if is_macos; then
        rdctl shutdown
    fi
}
