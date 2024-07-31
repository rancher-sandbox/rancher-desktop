load '../helpers/load'

local_setup() {
    # Tell start_container_engine to store additional settings in the current
    # profile and not in settings.json.
    RD_USE_PROFILE=true

    RD_USE_IMAGE_ALLOW_LIST=true

    ALLOWED_EXTENSION_NAME="joycelin79/newman-extension"
    ALLOWED_EXTENSION_TAG="0.0.7"
    FORBIDDEN_EXTENSION_TAG="0.0.5"
    FORBIDDEN_EXTENSION="ignatandrei/blockly-automation" # spellcheck-ignore-line
    KUBERNETES_RANDOM_VERSION="1.23.5"

    # profile settings should be the opposite of the default config
    if using_docker; then
        DEFAULTS_CONTAINER_ENGINE_NAME=containerd
    else
        DEFAULTS_CONTAINER_ENGINE_NAME=moby
    fi
    DEFAULTS_START_IN_BACKGROUND=true
    DEFAULTS_KUBERNETES_VERSION="$RD_KUBERNETES_VERSION"

    LOCKED_KUBERNETES_VERSION="1.27.3"
    LOCKED_ALLOWED_IMAGES_ENABLED=true
    LOCKED_ALLOWED_IMAGES_PATTERNS=("$ALLOWED_EXTENSION_NAME" "$IMAGE_NGINX")
    LOCKED_EXTENSIONS_ALLOWED_ENABLED=true
    LOCKED_EXTENSIONS_ALLOWED_LIST=("$ALLOWED_EXTENSION_NAME:$ALLOWED_EXTENSION_TAG")
}

local_teardown_file() {
    foreach_profile delete_profile
}

start_app() {
    # Store WSL integration and allowed images list in locked profile instead of settings.json
    PROFILE_TYPE=$PROFILE_LOCKED
    start_container_engine
    try --max 40 --delay 5 rdctl api /settings

    RD_CONTAINER_ENGINE=$(jq_output .containerEngine.name)
    wait_for_container_engine
}

verify_profiles() {
    local PROFILE_TYPE
    for PROFILE_TYPE in "$PROFILE_LOCKED" "$PROFILE_DEFAULTS"; do
        run profile_exists
        "${assert}_success"
    done
}

verify_settings() {
    # settings from defaults profile
    run get_setting .containerEngine.name
    "${assert}_output" "$DEFAULTS_CONTAINER_ENGINE_NAME"

    run get_setting .application.startInBackground
    "${assert}_output" "$DEFAULTS_START_IN_BACKGROUND"

    # settings from locked profile
    run get_setting .containerEngine.allowedImages.enabled
    "${assert}_output" "$LOCKED_ALLOWED_IMAGES_ENABLED"

    run get_setting .containerEngine.allowedImages.patterns
    "${assert}_output" --partial "${LOCKED_ALLOWED_IMAGES_PATTERNS[@]}"

    run get_setting .application.extensions.allowed.enabled
    "${assert}_output" "$LOCKED_EXTENSIONS_ALLOWED_ENABLED"

    run get_setting .application.extensions.allowed.list
    "${assert}_output" --partial "${LOCKED_EXTENSIONS_ALLOWED_LIST[@]}"

    run get_setting .kubernetes.version
    "${assert}_output" "$LOCKED_KUBERNETES_VERSION"
    "${refute}_output" "$DEFAULTS_KUBERNETES_VERSION"
}

install_extensions() {
    # Extension install doesn't work until startup is fully complete.
    wait_for_backend

    RD_TIMEOUT=120s run rdctl extension install "$FORBIDDEN_EXTENSION"
    "${refute}_success"

    RD_TIMEOUT=120s run rdctl extension install "$ALLOWED_EXTENSION_NAME:$FORBIDDEN_EXTENSION_TAG"
    "${refute}_success"

    RD_TIMEOUT=120s run rdctl extension install "${LOCKED_EXTENSIONS_ALLOWED_LIST[0]}"
    assert_success
}

@test 'initial factory reset' {
    factory_reset
}

@test 'start up with NO profiles' {
    assert_not_equal "$DEFAULTS_KUBERNETES_VERSION" "$LOCKED_KUBERNETES_VERSION"
    assert_not_equal "$KUBERNETES_RANDOM_VERSION" "$LOCKED_KUBERNETES_VERSION"
    RD_USE_PROFILE=false
    RD_USE_IMAGE_ALLOW_LIST=false
    start_application
}

@test 'verify there were NO profiles created' {
    before verify_profiles
}

@test 'verify default settings were applied' {
    before verify_settings
}

@test 'verify all extensions can be installed' {
    wait_for_kubelet
    before install_extensions
}

@test 'factory reset before creating profiles' {
    factory_reset
}

@test 'create profiles' {
    PROFILE_TYPE=$PROFILE_LOCKED
    create_profile
    add_profile_int version 10

    PROFILE_TYPE=$PROFILE_DEFAULTS
    create_profile
    add_profile_int version 10
    add_profile_bool application.startInBackground "$DEFAULTS_START_IN_BACKGROUND"
    verify_profiles
}

@test 'create defaults profile' {
    PROFILE_TYPE=$PROFILE_DEFAULTS
    add_profile_bool application.startInBackground "$DEFAULTS_START_IN_BACKGROUND"
    add_profile_string containerEngine.name "$DEFAULTS_CONTAINER_ENGINE_NAME"
    add_profile_string kubernetes.version "$DEFAULTS_KUBERNETES_VERSION"
}

@test 'create locked profile' {
    PROFILE_TYPE="$PROFILE_LOCKED"
    add_profile_bool containerEngine.allowedImages.enabled "$LOCKED_ALLOWED_IMAGES_ENABLED"
    add_profile_list containerEngine.allowedImages.patterns "${LOCKED_ALLOWED_IMAGES_PATTERNS[@]}"
    add_profile_bool application.extensions.allowed.enabled "$LOCKED_EXTENSIONS_ALLOWED_ENABLED"
    add_profile_list application.extensions.allowed.list "${LOCKED_EXTENSIONS_ALLOWED_LIST[@]}"
    add_profile_string kubernetes.version "$LOCKED_KUBERNETES_VERSION"
}

@test 'start app with new profiles' {
    RD_CONTAINER_ENGINE=""
    start_app
}

@test 'verify profile settings were applied' {
    verify_settings
}

@test 'install only allowed extensions' {
    install_extensions
}

@test 'try to change locked fields via rdctl set' {
    run rdctl set --container-engine.allowed-images.enabled=false
    assert_failure
    assert_output --partial 'field "containerEngine.allowedImages.enabled" is locked'

    run rdctl set --kubernetes.version="$KUBERNETES_RANDOM_VERSION"
    assert_failure
    assert_output --partial 'field "kubernetes.version" is locked'
}

api_set() {
    local body version
    body=$(jq ".version=10" <<<"{$1}")
    rdctl api /v1/settings -X PUT --body "$body"
}

@test 'try to change locked fields via API' {
    run api_set '"containerEngine": {"allowedImages": {"patterns": ["pattern1"]}}'
    assert_failure
    assert_output --partial 'field "containerEngine.allowedImages.patterns" is locked'

    run api_set '"containerEngine": {"allowedImages": {"enabled": false}}'
    assert_failure
    assert_output --partial 'field "containerEngine.allowedImages.enabled" is locked'

    run api_set '"application": {"extensions": {"allowed": {"enabled": false}}}'
    assert_failure
    assert_output --partial 'field "application.extensions.allowed.enabled" is locked'

    run api_set '"application": {"extensions": {"allowed": {"list": ["pattern1"]}}}'
    assert_failure
    assert_output --partial 'field "application.extensions.allowed.list" is locked'

    run api_set '"kubernetes": {"version": "'"$KUBERNETES_RANDOM_VERSION"'"}'
    assert_failure
    assert_output --partial 'field "kubernetes.version" is locked'
}

@test 'ensure locked settings are preserved' {
    verify_settings
}

@test 'change defaults profile setting' {
    run rdctl set --application.start-in-background=false
    assert_success

    run rdctl set --application.auto-start=true
    assert_success

    run rdctl set --kubernetes.version="$KUBERNETES_RANDOM_VERSION"
    assert_failure
}

@test 'verify that the new defaults settings are applied' {
    DEFAULTS_START_IN_BACKGROUND=false
    verify_settings
    run get_setting .application.autoStart
    assert_output true
}

@test 'shutdown app' {
    rdctl shutdown
}

@test 'restart app' {
    RD_CONTAINER_ENGINE=""
    start_app
}

@test 'verify that default profile is not applied again' {
    DEFAULTS_START_IN_BACKGROUND=false
    verify_settings
    run get_setting .application.autoStart
    assert_output true
}

@test 'shutdown Rancher Desktop' {
    rdctl shutdown
}

@test 'try to change locked fields via rdctl start and watch it fail' {
    launch_the_application --container-engine.allowed-images.enabled=false
    if using_dev_mode; then
        numTries=36
    else
        numTries=12
    fi
    try --max $numTries --delay 5 assert_file_contains "$PATH_LOGS/background.log" 'field "containerEngine.allowedImages.enabled" is locked'

    # The app-launch commands are expected to fail. We wait until we see the failure
    # message in the log file, but at that time the process may still be running.
    # Make sure that Rancher Desktop has really stopped; otherwise `rdctl start/yarn dev` may not launch a new instance
    rdctl shutdown

    launch_the_application --kubernetes.version="1.16.15"
    try --max $numTries --delay 5 assert_file_contains "$PATH_LOGS/background.log" 'field "kubernetes.version" is locked'
    # And again verify that the app is no longer running
    rdctl shutdown
}

@test 'restart application' {
    RD_CONTAINER_ENGINE=""
    start_app
}

@test 'ensure profile settings are preserved' {
    DEFAULTS_START_IN_BACKGROUND=false
    verify_settings
}
