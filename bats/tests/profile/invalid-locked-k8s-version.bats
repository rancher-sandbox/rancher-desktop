load '../helpers/load'

local_setup() {
    RD_USE_PROFILE=true
}

@test 'initial factory reset' {
    factory_reset
}

@test 'create profile' {
    PROFILE_TYPE=$PROFILE_LOCKED
    RD_USE_PROFILE=true
    create_profile
    profile_exists
    add_profile_string kubernetes.version NattyBo
    profile_exists
}

@test 'fails to start app with new profile' {
    PROFILE_TYPE=$PROFILE_LOCKED
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

@test 'remove profiles' {
    foreach_profile delete_profile
}
