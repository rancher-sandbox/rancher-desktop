# Test cases 8, 13, 19

load '../helpers/load'
ARCH_FOR_KUBERLR=amd64

@test 'factory reset' {
    factory_reset
}

@test 'start rancher desktop' {
    start_kubernetes
    wait_for_apiserver
    # the docker context "rancher-desktop" may not have been written
    # even though the apiserver is already running
    wait_for_container_engine
}

@test 'deploy nginx - always restart' {
    ctrctl pull nginx
    run ctrctl run -d -p 8585:80 --restart=always --name nginx-restart nginx
    assert_success
}

@test 'deploy nginx - no restart' {
    run ctrctl run -d -p 8686:80 --restart=no --name nginx-no-restart nginx
    assert_success
}

@test 'deploy busybox' {
    run kubectl create deploy busybox --image=busybox --replicas=2 -- /bin/sh -c "sleep inf"
    assert_success
}

verify_nginx() {
    for port in 8585 8686; do
        run curl "http://localhost:$port"
        assert_success
        assert_output --partial "Welcome to nginx!"
    done
}

@test 'verify nginx before upgrade' {
    try verify_nginx
    assert_success
}

verify_busybox() {
    run kubectl get pods --selector="app=busybox" -o jsonpath='{.items[*].status.phase}'
    assert_output --partial "Running Running"
}

@test 'verify busybox before upgrade' {
    try verify_busybox
    assert_success
}

verify_images() {
    if using_docker; then
        run docker images
        assert_output --partial "nginx" "busybox"
    else
        run nerdctl images --format json
        assert_output --partial '"Repository":"nginx'
        run nerdctl --namespace k8s.io images
        assert_output --partial "busybox"
    fi
}
@test 'verify images before upgrade' {
    verify_images
}

# Remove all the kubectl clients from the .kuberlr directory.
# Then run `kubectl`, and it should pull in the `kubectl` for
# the current k8s version in that directory.

verify_kuberlr_for_version() {
    local K8S_VERSION=$1
    local KUBERLR_DIR="${HOME}/.kuberlr/${OS}-${ARCH_FOR_KUBERLR}"
    rm -f "${KUBERLR_DIR}/kubectl"*
    run kubectl version
    assert_output --regexp "Client Version.*GitVersion:.v${K8S_VERSION}"
    assert_exists "${KUBERLR_DIR}/kubectl${K8S_VERSION}"
}

@test 'upgrade kubernetes' {
    rdctl set --kubernetes.version "$RD_KUBERNETES_VERSION"
    wait_for_apiserver "$RD_KUBERNETES_VERSION"
    wait_for_container_engine
}

@test 'kuberlr pulls in kubectl for new k8s version' {
    verify_kuberlr_for_version "$RD_KUBERNETES_VERSION"
}

verify_nginx_after_change_k8s() {
    run curl http://localhost:8686
    assert_failure
    assert_output --partial "Failed to connect to localhost port 8686"

    run curl http://localhost:8585
    assert_success
    assert_output --partial "Welcome to nginx!"
}

@test 'verify nginx after upgrade' {
    try verify_nginx_after_change_k8s
    assert_success
}

@test 'verify busybox after upgrade' {
    try verify_busybox
    assert_success
}

@test 'verify images after upgrade' {
    verify_images
}

@test 'restart nginx-no-restart before downgrade' {
    if using_docker; then
        run docker start nginx-no-restart
        assert_success
    else
        # BUG BUG BUG
        # After restarting the VM nerdctl fails to restart stopped containers.
        # It will eventually succeed after retrying multiple times (typically twice).
        # See https://github.com/containerd/nerdctl/issues/665#issuecomment-1372862742
        # BUG BUG BUG
        try nerdctl start nginx-no-restart
        assert_success
    fi
    try verify_nginx
    assert_success
}

@test 'downgrade kubernetes' {
    rdctl set --kubernetes-version "$RD_KUBERNETES_PREV_VERSION"
    wait_for_apiserver
    wait_for_container_engine
}

@test 'kuberlr pulls in kubectl for previous k8s version' {
    verify_kuberlr_for_version "$RD_KUBERNETES_PREV_VERSION"
}

@test 'verify nginx after downgrade' {
    # nginx should still be running because it is not managed by kubernetes
    try verify_nginx_after_change_k8s
    assert_success
}

@test 'verify busybox is gone after downgrade' {
    run kubectl get pods --selector="app=busybox"
    assert_output --partial "No resources found"
}

@test 'verify images after downgrade' {
    verify_images
}

teardown_file() {
    load '../helpers/load'

    run ctrctl rm -f nginx-restart nginx-no-restart
    assert_nothing
    run kubectl delete --selector="app=busybox"
    assert_nothing
}
