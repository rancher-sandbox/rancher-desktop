load '../helpers/load'

local_teardown_file() {
    foreach_profile delete_profile
}

@test 'create version 10 locked profile' {
    PROFILE_TYPE=$PROFILE_LOCKED
    create_profile
    add_profile_int version 10
}

@test 'start application' {
    factory_reset
    start_container_engine
    wait_for_container_engine
}

@test 'WASM mode should be locked down' {
    run rdctl set --experimental.container-engine.web-assembly.enabled
    assert_failure
    assert_output --partial 'field "experimental.containerEngine.webAssembly.enabled" is locked'
}

@test 'update locked profile to version 11' {
    PROFILE_TYPE=$PROFILE_LOCKED
    add_profile_int version 11
}

@test 'restart application with version 11 locked profile' {
    factory_reset
    start_container_engine
    wait_for_backend
}

@test 'WASM mode is now unlocked' {
    run rdctl set --experimental.container-engine.web-assembly.enabled
    assert_success
    assert_output --partial 'reconfiguring Rancher Desktop to apply changes'
}
