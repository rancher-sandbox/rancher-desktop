load '../helpers/load'
RD_USE_IMAGE_ALLOW_LIST=true

@test 'catch attempts to add duplicate patterns via the API with enabled on' {
    factory_reset
    start_kubernetes
    wait_for_apiserver
    wait_for_container_engine

    run update_allowed_patterns true '"nginx", "busybox", "ruby", "busybox"'
    assert_failure
    assert_output --partial $'field \'containerEngine.allowedImages.patterns\' has duplicate entries: "busybox"'
}

@test 'catch attempts to add duplicate patterns via the API with enabled off' {
    run update_allowed_patterns false '"nginx", "busybox", "ruby", "busybox"'
    assert_failure
    assert_output --partial $'field \'containerEngine.allowedImages.patterns\' has duplicate entries: "busybox"'
}
