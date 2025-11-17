# Test cases 8, 13, 19

load '../helpers/load'

local_setup_file() {
    if semver_eq "$RD_KUBERNETES_VERSION" "$RD_KUBERNETES_ALT_VERSION"; then
        printf "Cannot upgrade from %s to %s\n" \
            "$RD_KUBERNETES_VERSION" "$RD_KUBERNETES_ALT_VERSION" |
            fail
    fi
    # It is undefined whether RD_KUBERNETES_VERSION is greater or less than
    # RD_KUBERNETES_ALT_VERSION (and it's expected to flip in CI); actually
    # compare them so we can expect to wipe data on the downgrade.
    if semver_gt "$RD_KUBERNETES_VERSION" "$RD_KUBERNETES_ALT_VERSION"; then
        export RD_KUBERNETES_VERSION_LOW=$RD_KUBERNETES_ALT_VERSION
        export RD_KUBERNETES_VERSION_HIGH=$RD_KUBERNETES_VERSION
    else
        export RD_KUBERNETES_VERSION_LOW=$RD_KUBERNETES_VERSION
        export RD_KUBERNETES_VERSION_HIGH=$RD_KUBERNETES_ALT_VERSION
    fi
    case "$(uname -m)" in
    amd64 | x86_64 | i*86) export ARCH_FOR_KUBERLR=amd64 ;;
    arm*) export ARCH_FOR_KUBERLR=arm64 ;;
    *) printf "Unsupported architecture %s\n" "$(uname -m)" | fail ;;
    esac
}

@test 'factory reset' {
    factory_reset
}

@test 'start rancher desktop' {
    # Force use the pre-upgrade version
    RD_KUBERNETES_VERSION=$RD_KUBERNETES_VERSION_LOW start_kubernetes
    wait_for_kubelet "$RD_KUBERNETES_VERSION_LOW"
    # the docker context "rancher-desktop" may not have been written
    # even though the apiserver is already running
    wait_for_container_engine
}

@test 'deploy nginx - always restart' {
    ctrctl pull "$IMAGE_NGINX"
    run ctrctl run -d -p 8585:80 --restart=always --name nginx-restart "$IMAGE_NGINX"
    assert_success
}

@test 'deploy nginx - no restart' {
    run ctrctl run -d -p 8686:80 --restart=no --name nginx-no-restart "$IMAGE_NGINX"
    assert_success
}

@test 'deploy busybox' {
    run kubectl create deploy busybox --image="$IMAGE_BUSYBOX" --replicas=2 -- /bin/sh -c "sleep inf"
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
}

verify_busybox() {
    run kubectl get pods --selector="app=busybox" -o jsonpath='{.items[*].status.phase}'
    assert_output --partial "Running Running"
}

@test 'verify busybox before upgrade' {
    try verify_busybox
}

verify_images() {
    if using_docker; then
        run docker images --format '{{.Repository}}'
        assert_line "$IMAGE_NGINX"
        assert_line "$IMAGE_BUSYBOX"
    else
        run nerdctl images --format '{{.Repository}}'
        assert_line "$IMAGE_NGINX"
        run nerdctl --namespace k8s.io images --format '{{.Repository}}'
        assert_line "$IMAGE_BUSYBOX"
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
    local KUBERLR_DIR="${USERPROFILE}/.kuberlr/${OS}-${ARCH_FOR_KUBERLR}"

    rm -f "${KUBERLR_DIR}/kubectl"*
    run kubectl version
    assert_output --regexp "Client Version.*:.v${K8S_VERSION}"
    assert_exists "${KUBERLR_DIR}/kubectl${K8S_VERSION}$EXE"
}

@test 'upgrade kubernetes' {
    rdctl set --kubernetes.version "$RD_KUBERNETES_VERSION_HIGH"
    wait_for_kubelet "$RD_KUBERNETES_VERSION_HIGH"
    wait_for_container_engine
}

@test 'kuberlr pulls in kubectl for new k8s version' {
    verify_kuberlr_for_version "$RD_KUBERNETES_VERSION_HIGH"
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
}

@test 'verify busybox after upgrade' {
    try verify_busybox
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
    fi
    try verify_nginx
}

@test 'downgrade kubernetes' {
    rdctl set --kubernetes.version "$RD_KUBERNETES_VERSION_LOW"
    wait_for_kubelet "$RD_KUBERNETES_VERSION_LOW"
    wait_for_container_engine
}

@test 'kuberlr pulls in kubectl for previous k8s version' {
    verify_kuberlr_for_version "$RD_KUBERNETES_VERSION_LOW"
}

@test 'verify nginx after downgrade' {
    # nginx should still be running because it is not managed by kubernetes
    try verify_nginx_after_change_k8s
}

@test 'verify busybox is gone after downgrade' {
    run kubectl get pods --selector="app=busybox"
    assert_output --partial "No resources found"
}

@test 'verify images after downgrade' {
    verify_images
}

local_teardown_file() {
    run ctrctl rm -f nginx-restart nginx-no-restart
    assert_nothing
    run kubectl delete --selector="app=busybox"
    assert_nothing
}
