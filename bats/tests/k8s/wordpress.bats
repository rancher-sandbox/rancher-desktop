# Test case 8 & 13

# shellcheck disable=SC2030,SC2031
# SC2030 (info): Modification of output is local (to subshell caused by @bats test).
# SC2031 (info): output was modified in a subshell. That change might be lost.

setup() {
    load '../helpers/load'
}

@test 'factory reset' {
    factory_reset
}

@test 'add helm repo' {
    helm repo add bitnami https://charts.bitnami.com/bitnami
    helm repo update bitnami
}

@test 'start rancher desktop' {
    start_kubernetes
    wait_for_apiserver
    # the docker context "rancher-desktop" may not have been written
    # even though the apiserver is already running
    wait_for_container_engine
}

@test 'deploy nginx' {
    ctrctl pull nginx
    ctrctl run -d -p 8585:80 --restart=always --name nginx nginx
}

verify_nginx() {
    run curl http://localhost:8585
    assert_success
    assert_output --partial "Welcome to nginx!"
}

@test 'deploy wordpress' {
    helm install wordpress bitnami/wordpress \
          --wait \
          --timeout 20m \
          --set service.type=NodePort \
          --set volumePermissions.enabled=true \
          --set mariadb.volumePermissions.enabled=true
}

verify_wordpress() {
    run helm list
    assert_success
    assert_line --regexp "$(printf '^wordpress[ \t]+default')"

    # Fetch wordpress port
    run kubectl get --namespace default -o jsonpath="{.spec.ports[0].nodePort}" services wordpress
    assert_success

    # Load the homepage; that can take a while because all the pods are still restarting
    try --max 9 --delay 10 curl --silent --show-error "http://localhost:$output"
    assert_success
    assert_output --regexp "(Just another WordPress site|<title>User&#039;s Blog!</title>)"
}

@test 'verify nginx before upgrade' {
    verify_nginx
}

@test 'verify wordpress before upgrade' {
    verify_wordpress
}

@test 'upgrade kubernetes' {
    rdctl set --kubernetes-version "$RD_KUBERNETES_VERSION"
    wait_for_apiserver "$RD_KUBERNETES_VERSION"
}

@test 'verify nginx after upgrade' {
    verify_nginx
}

@test 'verify wordpress after upgrade' {
    verify_wordpress
}

@test 'downgrade kubernetes' {
    rdctl set --kubernetes-version "$RD_KUBERNETES_PREV_VERSION"
    wait_for_apiserver
}

@test 'verify nginx after downgrade' {
    # nginx should still be running because it is not managed by kubernetes
    verify_nginx
}

@test 'verify wordpress is gone after downgrade' {
    # downgrading kubernetes deletes all workloads
    run helm list
    assert_success
    refute_line --regexp "$(printf '^wordpress[ \t]+default')"
    #verify_wordpress
}

teardown_file() {
    load '../helpers/load'

    run ctrctl rm -f nginx

    run helm uninstall wordpress --wait
    # The database PVC doesn't get deleted by `helm uninstall`.
    run kubectl delete pvc data-wordpress-mariadb-0
}
