load '../helpers/load'

local_setup() {
    skip_on_unix 'roaming appdata => local appdata migration is windows-only'
    ROAMING_HOME="$(wslpath_from_win32_env APPDATA)/rancher-desktop"
}

@test 'factory reset' {
    factory_reset
    # WSL sometimes ends up not seeing deletes from Windows; force it here.
    rm -rf "$PATH_CONFIG" "$ROAMING_HOME"
}

@test 'start app, create a setting, and move settings to roaming' {
    start_container_engine
    wait_for_container_engine

    rdctl api -X PUT /settings --body '{ "version": 9, "WSL": {"integrations": { "beaker" : true }}}'
    rdctl shutdown
    create_file "$ROAMING_HOME/settings.json" <"$PATH_CONFIG_FILE"
    rm "$PATH_CONFIG_FILE"
}

@test 'restart app, verify settings has been migrated' {
    launch_the_application
    wait_for_container_engine

    run rdctl api /settings
    assert_success
    run jq_output .WSL.integrations.beaker
    assert_success
    assert_output true
}

@test 'verify the settings file exists in both Local/ and Roaming/' {
    # Migration doesn't delete it from Roaming/ in case the user decides to roll back to an earlier version.
    test -f "$PATH_CONFIG_FILE"
    test -f "$ROAMING_HOME/settings.json"
}

@test 'verify factory-reset deletes all of Roaming/rancher-desktop' {
    rdctl factory-reset
    assert_not_exists "$ROAMING_HOME"
}
