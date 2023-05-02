load '../helpers/load'
RD_USE_IMAGE_ALLOW_LIST=true

@test 'start' {
    factory_reset
    start_kubernetes
    wait_for_apiserver
    wait_for_container_engine
}

@test 'update the list of patterns first time' {
    update_allowed_patterns true '"nginx", "busybox", "python"'
}

@test 'verify pull nginx succeeds' {
    ctrctl pull --quiet nginx
}

@test 'verify pull busybox succeeds' {
    ctrctl pull --quiet busybox
}

@test 'verify pull python succeeds' {
    ctrctl pull --quiet python
}

@test 'verify pull ruby fails' {
    run ctrctl pull ruby
    assert_failure
}

@test 'drop python from the allowed-image list, add ruby' {
    update_allowed_patterns true '"nginx", "busybox", "ruby"'
}

@test 'clear images' {
    for image in nginx busybox python; do
        ctrctl rmi "$image"
    done
}

@test 'verify pull python fails' {
    run ctrctl pull --quiet python
    assert_failure
}

@test 'verify pull ruby succeeds' {
    ctrctl pull --quiet ruby
}

@test 'clear all patterns' {
    update_allowed_patterns true ''
}

@test 'can run kubectl' {
    wait_for_apiserver
    kubectl run nginx --image=nginx:latest --port=8080
}

verify_no_nginx() {
    run kubectl get pods
    assert_success
    assert_output --partial "ImagePullBackOff"
}

@test 'but fails to stand up a pod for forbidden image' {
    try --max 18 --delay 10 verify_no_nginx
    assert_success
}

@test 'set patterns with the allowed list disabled' {
    update_allowed_patterns false '"nginx", "busybox", "ruby"'
    # containerEngine.allowedImages.enabled changed, so wait for a restart
    wait_for_apiserver "$RD_KUBERNETES_PREV_VERSION"
}

@test 'verify pull python succeeds because allowedImages filter is disabled' {
    ctrctl pull --quiet python
}
