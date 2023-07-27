load '../helpers/load'

local_setup() {
    RD_USE_PROFILE=true
    PROFILE_TYPE=$PROFILE_LOCKED
}

local_teardown_file() {
    foreach_profile delete_profile
}

@test 'initial factory reset' {
    factory_reset
}

@test 'create profile' {
    create_profile
    add_profile_string kubernetes.version NattyBo
}

@test 'fails to start app with an invalid locked k8s version' {
    # Have to set the version field or RD will think we're trying to change a locked field.
    RD_KUBERNETES_PREV_VERSION=NattyBo
    start_kubernetes
    # Don't do the full wait_for_container_engine because RD will shut down in the middle
    # and the function will take a long time to time out making futile queries.
    trace "waiting for api /settings to be callable"
    try --max 30 --delay 5 rdctl api /settings
    # Can't wait for the kubernetes server because it isn't going to start
    try --max 60 --delay 5 assert_file_contains "$PATH_LOGS/background.log" "Kubernetes was unable to start: LockedFieldError: Locked kubernetes version 'NattyBo' isn't a valid version"
}

@test 'recreate profile with a valid k8s version' {
    add_profile_string kubernetes.version v1.27.1
}

@test 'fails to start app with a specified k8s version != locked k8s version' {
    # Have to set the version field or RD will think we're trying to change a locked field.
    RD_KUBERNETES_PREV_VERSION=v1.27.2
    start_kubernetes
    try --max 60 --delay 5 assert_file_contains "$PATH_LOGS/background.log" "Kubernetes was unable to start: LockedFieldError: Error in deployment profiles:"
    assert_file_contains "$PATH_LOGS/background.log" "field 'kubernetes.version' is locked"
}
