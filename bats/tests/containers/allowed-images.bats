load '../helpers/load'
RD_USE_IMAGE_ALLOW_LIST=true

@test 'start' {
    factory_reset
    start_kubernetes
    wait_for_container_engine
    wait_for_kubelet
}

@test 'update the list of patterns first time' {
    update_allowed_patterns true "$IMAGE_NGINX" "$IMAGE_BUSYBOX" "$IMAGE_PYTHON"
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

assert_pull_fails() {
    run ctrctl pull "$1"
    assert_failure
    assert_output --regexp "(UNAUTHORIZED|Forbidden)"
}

@test 'verify pull ruby fails' {
    try --max 9 --delay 10 assert_pull_fails "$IMAGE_RUBY"
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
    try --max 9 --delay 10 assert_pull_fails "$IMAGE_PYTHON"
}

@test 'verify pull ruby succeeds' {
    # when using VZ and when traefik is enabled, then pulling the image does not always succeed on the first attempt
    try --max 9 --delay 10 ctrctl pull --quiet "$IMAGE_RUBY"
}

@test 'clear all patterns' {
    update_allowed_patterns true
}

@test 'can run kubectl' {
    kubectl run nginx --image="${IMAGE_NGINX}" --port=8080
}

verify_no_nginx() {
    run kubectl get pods
    assert_success
    assert_output --partial "ImagePullBackOff"
}

@test 'but fails to stand up a pod for forbidden image' {
    try --max 18 --delay 10 verify_no_nginx
}

@test 'set patterns with the allowed list disabled' {
    update_allowed_patterns false "$IMAGE_NGINX" "$IMAGE_BUSYBOX" "$IMAGE_RUBY"
}

@test 'verify pull python succeeds because allowedImages filter is disabled' {
    # when using VZ and when traefik is enabled, then pulling the image does not always succeed on the first attempt
    try --max 9 --delay 10 ctrctl pull --quiet "$IMAGE_PYTHON"
}
