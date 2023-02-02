# Test case 11 & 12

setup() {
    load '../helpers/load'

    # TODO - Consider implementing a function to check for sudo permissions before running tests that require them. 
    # If sudo permissions are not present, these tests should be skipped.
    if is_linux; then
        run sudo sysctl -w net.ipv4.ip_unprivileged_port_start=443
    fi
}

@test 'factory reset' {
    factory_reset
}

@test 'start k8s' {
    start_kubernetes
    wait_for_apiserver
}

@test 'add helm repo' {
    helm repo add jetstack https://charts.jetstack.io        
    helm repo add rancher-latest https://releases.rancher.com/server-charts/latest
    helm repo update
}

get_host() {
    if is_windows; then
        local LB_IP=$(kubectl get svc traefik --namespace kube-system | awk 'NR==2{print $4}')
        echo "$LB_IP.sslip.io"
    else
        echo "localhost"
    fi
    return 0
}

@test 'deploy rancher' {
    helm upgrade \
        --install cert-manager jetstack/cert-manager \
        --namespace cert-manager \
        --set installCRDs=true \
        --set "extraArgs[0]=--enable-certificate-owner-ref=true" \
        --create-namespace
    helm upgrade \
        --install rancher rancher-latest/rancher \
        --namespace cattle-system  \
        --set hostname=$(get_host) \
        --wait \
        --timeout=10m \
        --create-namespace
}

@test 'verify rancher' {
    try --max 9 --delay 10 curl --insecure --silent --show-error "https://$(get_host)/dashboard/auth/login"
    assert_success
    assert_output --partial "Rancher Dashboard"
    run kubectl get secret --namespace cattle-system bootstrap-secret -o json
    assert_success
    assert_output --partial "bootstrapPassword"
}

teardown_file() {
    load '../helpers/load'

    run helm uninstall rancher --namespace cattle-system --wait
    run helm uninstall cert-manager --namespace cert-manager --wait
}
