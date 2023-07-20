load '../helpers/load'

local_setup() {
    # profile settings should be the opposite of the default config
    if using_docker; then
        PROFILE_CONTAINER_ENGINE=containerd
    else
        PROFILE_CONTAINER_ENGINE=moby
    fi
    PROFILE_START_IN_BACKGROUND=true
    RD_USE_PROFILE=true
}

local_teardown_file() {
    foreach_profile delete_profile
}

start_app() {
    # Store WSL integration and allowed images list in locked profile instead of settings.json
    PROFILE_TYPE=$PROFILE_LOCKED
    start_container_engine
    try --max 20 --delay 5 rdctl api /settings

    RD_CONTAINER_ENGINE=$(jq_output .containerEngine.name)
    wait_for_container_engine
}

verify_settings() {
    PROFILE_TYPE=$PROFILE_LOCKED
    run profile_exists
    "${assert}_success"

    PROFILE_TYPE=$PROFILE_DEFAULTS
    run profile_exists
    "${assert}_success"

    run get_setting .containerEngine.name
    "${assert}_output" "$PROFILE_CONTAINER_ENGINE"

    run get_setting .application.startInBackground
    "${assert}_output" "$PROFILE_START_IN_BACKGROUND"
}

@test 'initial factory reset' {
    factory_reset
}

@test 'start up without profile' {
    RD_USE_PROFILE=false
    start_app
}

@test 'verify default settings' {
    before verify_settings
}

@test 'factory reset' {
    factory_reset
}

@test 'create profile' {
    PROFILE_TYPE=$PROFILE_LOCKED
    create_profile
    add_profile_string containerEngine.name "$PROFILE_CONTAINER_ENGINE"

    PROFILE_TYPE=$PROFILE_DEFAULTS
    create_profile
    add_profile_bool application.startInBackground "$PROFILE_START_IN_BACKGROUND"
}

@test 'start app with new profile' {
    RD_CONTAINER_ENGINE=""
    start_app
}

@test 'verify profile settings' {
    verify_settings
}

@test 'change defaults profile setting' {
    rdctl set --application.start-in-background=false
}

@test 'restart app' {
    rdctl shutdown
    RD_CONTAINER_ENGINE=""
    start_app
}

@test 'verify that defaults settings are not applied again' {
    PROFILE_START_IN_BACKGROUND=false
    verify_settings
}
