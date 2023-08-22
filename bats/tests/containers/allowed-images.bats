load '../helpers/load'
RD_USE_IMAGE_ALLOW_LIST=true

@test 'start' {
    factory_reset
    start_kubernetes
    wait_for_container_engine
    wait_for_apiserver
}

@test 'update the list of patterns first time' {
    update_allowed_patterns true "$IMAGE_NGINX" "$IMAGE_BUSYBOX" "$IMAGE_PYTHON"
    wait_for_container_engine
}

@test 'verify pull nginx succeeds' {
    ctrctl pull --quiet "$IMAGE_NGINX"
}

@test 'verify pull busybox succeeds' {
    ctrctl pull --quiet "$IMAGE_BUSYBOX"
}

@test 'verify pull python succeeds' {
    ctrctl pull --quiet "$IMAGE_PYTHON"
}

@test 'verify pull ruby fails' {
    run ctrctl pull "$IMAGE_RUBY"
    assert_failure
}

@test 'drop python from the allowed-image list, add ruby' {
    update_allowed_patterns true "$IMAGE_NGINX" "$IMAGE_BUSYBOX" "$IMAGE_RUBY"
}

@test 'clear images' {
    for image in IMAGE_NGINX IMAGE_BUSYBOX IMAGE_PYTHON; do
        ctrctl rmi "${!image}"
    done
}

@test 'verify pull python fails' {
    run ctrctl pull --quiet "$IMAGE_PYTHON"
    assert_failure
}

@test 'verify pull ruby succeeds' {
    ctrctl pull --quiet "$IMAGE_RUBY"
}

@test 'clear all patterns' {
    update_allowed_patterns true
}

@test 'can run kubectl' {
    wait_for_apiserver
    kubectl run nginx --image="${IMAGE_NGINX}:latest" --port=8080
}

verify_no_nginx() {
    run kubectl get pods
    assert_success
    assert_output --partial "ImagePullBackOff"
}

@test 'but fails to stand up a pod for forbidden image' {
    try --max 18 --delay 10 verify_no_nginx
}

@test 'complain about duplicate whitespace in string-list properties' {
    run rdctl api -X PUT settings --body '{"containerEngine": {"allowedImages": {"patterns": ["c-stub", " ", "d-stub", "    ", "e-stub", ""] }}}'
    assert_failure
    assert_output --partial 'field "containerEngine.allowedImages.patterns" has duplicate entries:'
    refute_output --partial stub

    run rdctl api -X PUT settings --body '{"experimental": {"virtualMachine": {"proxy": {"noproxy": ["c-stub", " ", "d-stub", "    ", "e-stub", ""] }}}}'
    assert_failure
    assert_output --partial 'field "experimental.virtualMachine.proxy.noproxy" has duplicate entries:'
    refute_output --partial stub
}

@test 'set patterns with the allowed list disabled' {
    update_allowed_patterns false "$IMAGE_NGINX" "$IMAGE_BUSYBOX" "$IMAGE_RUBY"
    # containerEngine.allowedImages.enabled changed, so wait for a restart
    wait_for_container_engine
    wait_for_apiserver "$RD_KUBERNETES_PREV_VERSION"
}

@test 'verify pull python succeeds because allowedImages filter is disabled' {
    ctrctl pull --quiet "$IMAGE_PYTHON"
}
