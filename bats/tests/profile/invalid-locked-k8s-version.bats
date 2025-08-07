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
    add_profile_int version 8
    add_profile_string kubernetes.version NattyBo
}

@test 'fails to start app with an invalid locked k8s version' {
    # Have to set the version field or RD will think we're trying to change a locked field.
    RD_KUBERNETES_VERSION=NattyBo start_kubernetes
    # Don't do wait_for_container_engine because RD will shut down in the middle
    # and the function will take a long time to time out making futile queries.
    # The app should exit gracefully; after that we can check for contents.
    try --max 60 --delay 5 assert_file_contains "$PATH_LOGS/background.log" "Child exited"
    assert_file_contains "$PATH_LOGS/background.log" "Error Starting Rancher Desktop"
    assert_file_contains "$PATH_LOGS/background.log" "Locked kubernetes version 'NattyBo' isn't a valid version"
}

@test 'recreate profile with a valid k8s version' {
    add_profile_string kubernetes.version v1.27.1
}

@test 'fails to start app with a specified k8s version != locked k8s version' {
    factory_reset
    # Have to set the version field or RD will think we're trying to change a locked field.
    RD_KUBERNETES_VERSION=v1.27.2 start_kubernetes
    # The app should exit gracefully; after that we can check for contents.
    try --max 60 --delay 5 assert_file_contains "$PATH_LOGS/background.log" "Child exited"
    assert_file_contains "$PATH_LOGS/background.log" "Error Starting Rancher Desktop"
    assert_file_contains "$PATH_LOGS/background.log" 'field "kubernetes.version" is locked'
}
