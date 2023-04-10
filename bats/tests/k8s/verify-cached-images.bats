# Test cases 57, 58

setup() {
    load '../helpers/load'
}

@test 'factory reset' {
    factory_reset
}

@test 'start rancher desktop' {
    # Start first so we can use `rdctl set` in all the calls that change the k8s version
    start_kubernetes
    wait_for_apiserver
    # the docker context "rancher-desktop" may not have been written
    # even though the apiserver is already running
    wait_for_container_engine
}

test_k8s_version_has_correct_cached_extension() {
    local K8S_VERSION=$1
    local EXTENSION=$2
    rdctl set --kubernetes-version "$K8S_VERSION"
    wait_for_apiserver "$K8S_VERSION"
    wait_for_container_engine
    run ls "$PATH_CACHE/k3s/v${K8S_VERSION}"*k3s*/k3s-airgap-images-amd64."${EXTENSION}"
    assert_success
}

@test 'verify k8s 1.23.13 uses .tar.zst in the cache' {
    test_k8s_version_has_correct_cached_extension "1.23.13" "tar.zst"
}

@test 'verify k8s 1.25.3 uses .tar.zst in the cache' {
    test_k8s_version_has_correct_cached_extension "1.25.3" "tar.zst"
}

@test 'verify k8s 1.18.17 uses .tar in the cache' {
    test_k8s_version_has_correct_cached_extension "1.18.17" "tar"
}

@test 'verify k8s 1.26.3 uses .tar.zst in the cache' {
    test_k8s_version_has_correct_cached_extension "1.26.3" "tar.zst"
}

# Linux run didn't shutdown without this test.
@test 'shutdown' {
    run rdctl shutdown
    assert_success
}

teardown_file() {
    load '../helpers/load'

    run ctrctl rm -f nginx-restart nginx-no-restart
    assert_nothing
    run kubectl delete --selector="app=busybox"
    assert_nothing
}
