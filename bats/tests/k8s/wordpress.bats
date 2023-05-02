load '../helpers/load'

setup() {
    if is_macos arm64; then
        skip "The bitnami wordpress image is not available for arm64 architecture. Skipping..."
    fi
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
    # the docker context "rancher-desktop" may not have been writtengit
    # even though the apiserver is already running
    wait_for_container_engine
}

@test 'deploy wordpress' {
    helm install wordpress bitnami/wordpress \
        --wait \
        --timeout 20m \
        --set service.type=NodePort \
        --set volumePermissions.enabled=true \
        --set mariadb.volumePermissions.enabled=true
}

@test 'verify wordpress was deployed' {
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

teardown_file() {
    load '../helpers/load'
    run helm uninstall wordpress --wait
    assert_nothing

    # The database PVC doesn't get deleted by `helm uninstall`.
    run kubectl delete pvc data-wordpress-mariadb-0
    assert_nothing
}
