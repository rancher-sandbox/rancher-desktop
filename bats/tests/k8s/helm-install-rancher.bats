# Test case 11 & 12

load '../helpers/load'
RD_FILE_RAMDISK_SIZE=12 # We need more disk to run the Rancher image.

local_setup() {
    if [[ -z $RD_RANCHER_IMAGE_TAG ]]; then
        skip "RD_RANCHER_IMAGE_TAG is not set"
    fi
    needs_port 443
}

@test 'add helm repo' {
    helm repo add jetstack https://charts.jetstack.io
    helm repo add rancher-latest https://releases.rancher.com/server-charts/latest
    helm repo update
}

deploy_rancher() {
    # TODO remove `skip_unless_host_ip` once `traefik_hostname` no longer needs it
    if is_windows; then
        skip_unless_host_ip
    fi

    helm upgrade \
        --install cert-manager jetstack/cert-manager \
        --namespace cert-manager \
        --set installCRDs=true \
        --set "extraArgs[0]=--enable-certificate-owner-ref=true" \
        --create-namespace

    local host
    host=$(traefik_hostname) || return

    helm upgrade \
        --install rancher rancher-latest/rancher \
        --version "${RD_RANCHER_IMAGE_TAG#v}" \
        --namespace cattle-system \
        --set hostname="$host" \
        --wait \
        --timeout=10m \
        --create-namespace
}

verify_rancher() {
    # TODO remove `skip_unless_host_ip` once `traefik_hostname` no longer needs it
    if is_windows; then
        skip_unless_host_ip
    fi

    local host
    host=$(traefik_hostname) || return

    run try --max 9 --delay 10 curl --insecure --silent --show-error "https://${host}/dashboard/auth/login"
    assert_success
    assert_output --partial "Rancher Dashboard"
    run kubectl get secret --namespace cattle-system bootstrap-secret -o json
    assert_success
    assert_output --partial "bootstrapPassword"
}

uninstall_rancher() {
    run helm uninstall rancher --namespace cattle-system --wait
    assert_nothing
    run helm uninstall cert-manager --namespace cert-manager --wait
    assert_nothing
}

foreach_k3s_version \
    factory_reset \
    start_kubernetes \
    wait_for_kubelet \
    wait_for_traefik \
    deploy_rancher \
    verify_rancher \
    uninstall_rancher
