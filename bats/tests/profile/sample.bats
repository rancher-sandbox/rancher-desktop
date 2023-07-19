load '../helpers/load'

local_setup() {
    # profile settings should be the opposite of the default config
    if using_docker; then
        PROFILE_CONTAINER_ENGINE=containerd
    else
        PROFILE_CONTAINER_ENGINE=moby
    fi

    #defaults profile settings
    PROFILE_START_IN_BACKGROUND=true
    PROFILE_DEFAULTS_KUBERNETES_VERSION="$RD_KUBERNETES_VERSION"

    #locked profile settings
    PROFILE_LOCKED_KUBERNETES_VERSION=1.27.3
    PROFILE_USE_IMAGE_ALLOW_LIST=true
    PROFILE_IMAGE_PATTERNS=(joycelin79/newman-extension nginx)
    PROFILE_USE_EXTENSION_LIST=true
    PROFILE_EXTENSION_LIST=(joycelin79/newman-extension:0.0.7 nginx)

    RD_USE_PROFILE=true
    RD_USE_IMAGE_ALLOW_LIST=true
    RD_NO_MODAL_DIALOGS=true
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

verify_profiles() {
    PROFILE_TYPE=$PROFILE_LOCKED
    run profile_exists
    "${assert}_success" || return

    PROFILE_TYPE=$PROFILE_DEFAULTS
    run profile_exists
    "${assert}_success" || return
}

verify_settings() {
    #settings from defaults profile
    run get_setting .containerEngine.name
    "${assert}_output" "$PROFILE_CONTAINER_ENGINE" || return

    run get_setting .application.startInBackground
    "${assert}_output" "$PROFILE_START_IN_BACKGROUND" || return
    #settings from locked profile
    run get_setting .containerEngine.allowedImages.enabled
    "${assert}_output" "$PROFILE_USE_IMAGE_ALLOW_LIST" || return

    run get_setting .containerEngine.allowedImages.patterns
    "${assert}_output" --partial "${PROFILE_IMAGE_PATTERNS[@]}" || return

    run get_setting .application.extensions.allowed.enabled
    "${assert}_output" "$PROFILE_USE_EXTENSION_LIST" || return

    run get_setting .application.extensions.allowed.list
    "${assert}_output" --partial "${PROFILE_EXTENSION_LIST[@]}" || return

    run get_setting .kubernetes.version
    "${assert}_output" "$PROFILE_LOCKED_KUBERNETES_VERSION" || return
    refute_output "$PROFILE_DEFAULTS_KUBERNETES_VERSION" || return
}

@test 'initial factory reset' {
    factory_reset
}

@test 'start up with NO profiles' {
    RD_USE_PROFILE=false
    RD_USE_IMAGE_ALLOW_LIST=false
    start_application
}

@test 'verify there are NO profiles created' {
    before verify_profiles
}

@test 'verify default settings were applied' {
    before verify_settings
}

@test 'factory reset before creating profiles' {
    factory_reset
}

@test 'create profiles' {
    PROFILE_TYPE=$PROFILE_LOCKED
    create_profile

    PROFILE_TYPE=$PROFILE_DEFAULTS
    create_profile

    verify_profiles
}

@test 'add settings to defaults profiles' {
    PROFILE_TYPE=$PROFILE_DEFAULTS
    add_profile_bool application.startInBackground "$PROFILE_START_IN_BACKGROUND"
    add_profile_string containerEngine.name "$PROFILE_CONTAINER_ENGINE"
    add_profile_string kubernetes.version "$PROFILE_DEFAULTS_KUBERNETES_VERSION"
}

@test 'add settings to locked profile' {
    PROFILE_TYPE="$PROFILE_LOCKED"
    add_profile_bool containerEngine.allowedImages.enabled "$PROFILE_USE_IMAGE_ALLOW_LIST"
    add_profile_list containerEngine.allowedImages.patterns "${PROFILE_IMAGE_PATTERNS[@]}"
    add_profile_bool application.extensions.allowed.enabled "$PROFILE_USE_EXTENSION_LIST"
    add_profile_list application.extensions.allowed.list "${PROFILE_EXTENSION_LIST[@]}"
    add_profile_string kubernetes.version "$PROFILE_LOCKED_KUBERNETES_VERSION"
}

@test 'start app with new profiles' {
    RD_CONTAINER_ENGINE=""
    start_app
}

@test 'verify profile settings were applied' {
    verify_settings
}

@test 'try to install a not-allowed extension' {
    run rdctl extension install ignatandrei/blockly-automation
    assert_failure || return
    run rdctl extension install joycelin79/newman-extension:0.0.5
    assert_failure || return
}

@test 'install an allowed extension' {
    run rdctl extension install joycelin79/newman-extension:0.0.7
    assert_success || return
}

@test 'try to change locked fields via rdctl set' {
    run rdctl set --container-engine.allowed-images.enabled=false
    assert_failure || return

    run rdctl set --kubernetes.version="1.16.15"
    assert_failure || return
}

@test 'try to change locked fields via API' {
    run rdctl api /v1/settings -X PUT --body "{\"version\": \"$RD_API_VERSION\", \"containerEngine\": {\"allowedImages\": { \"patterns\": [ \"pattern1\" ] }}}"
    assert_failure || return
    run rdctl api /v1/settings -X PUT --body "{\"version\": \"$RD_API_VERSION\", \"containerEngine\": {\"allowedImages\": {\"enabled\": false }}}"
    assert_failure || return
    run rdctl api /v1/settings -X PUT --body "{\"version\": \"$RD_API_VERSION\", \"application\": {\"extensions\": { \"allowed\": false }}}"
    assert_failure || return
    run rdctl api /v1/settings -X PUT --body "{\"version\": \"$RD_API_VERSION\", \"application\": {\"extensions\": { \"list\": [\"pattern1\"] }}}"
    assert_failure || return
    run rdctl api /v1/settings -X PUT --body "{\"version\": \"$RD_API_VERSION\", \"kubernetes\": {\"version\": \"1.16.15\"}}"
    assert_failure || return
}

@test 'ensure locked settings are preserved' {
    verify_settings
}

@test 'change defaults profile setting' {
    run rdctl set --application.start-in-background=false
    assert_success || return
    run rdctl set --application.auto-start=true
    assert_success || return
    run rdctl set --kubernetes.version=1.19.16
    assert_failure || return
}

@test 'verify that the new defaults settings are applied' {
    PROFILE_START_IN_BACKGROUND=false
    verify_settings
    run get_setting .application.autoStart
    assert_output true || return
}

@test 'shutdown app' {
    rdctl shutdown
}

@test 'restart app' {
    RD_CONTAINER_ENGINE=""
    start_app
}

@test 'verify that default profile is not applied again' {
    PROFILE_START_IN_BACKGROUND=false
    verify_settings
    run get_setting .application.autoStart
    assert_output true || return
}


@test 'shutdown Rancher Desktop' {
    rdctl shutdown
}

@test 'try to change locked fields via rdctl start' {
    rdctl start --container-engine.allowed-images.enabled=false --no-modal-dialogs
    try --max 10 --delay 5 assert_file_contains "$PATH_LOGS/background.log" "field 'containerEngine.allowedImages.enabled' is locked"
    assert_success || return

    rdctl start --kubernetes.version="1.16.15" --no-modal-dialogs
    try --max 10 --delay 5 assert_file_contains "$PATH_LOGS/background.log" "field 'kubernetes.version' is locked"
    assert_success || return
}

@test 'restart application' {
    RD_CONTAINER_ENGINE=""
    start_app
}

@test 'ensure profile settings are preserved' {
    PROFILE_START_IN_BACKGROUND=false
    verify_settings
}
