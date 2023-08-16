load '../helpers/load'
RD_USE_IMAGE_ALLOW_LIST=true

@test 'catch attempts to add duplicate patterns via the API with enabled on' {
    factory_reset
    start_kubernetes
    wait_for_apiserver
    wait_for_container_engine

    run update_allowed_patterns true "$IMAGE_NGINX" "$IMAGE_BUSYBOX" "$IMAGE_RUBY" "$IMAGE_BUSYBOX"
    assert_failure
    assert_output --partial $"field \"containerEngine.allowedImages.patterns\" has duplicate entries: \"$IMAGE_BUSYBOX\""
}

@test 'catch attempts to add duplicate patterns via the API with enabled off' {
    run update_allowed_patterns false "$IMAGE_NGINX" "$IMAGE_BUSYBOX" "$IMAGE_RUBY" "$IMAGE_BUSYBOX"
    assert_failure
    assert_output --partial $"field \"containerEngine.allowedImages.patterns\" has duplicate entries: \"$IMAGE_BUSYBOX\""
}
