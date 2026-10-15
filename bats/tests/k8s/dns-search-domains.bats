load '../helpers/load'

local_setup_file() {
    if is_windows; then
        skip "the WSL network tunnel does not hand out search domains"
    fi
}

@test 'factory reset' {
    factory_reset
}

@test 'start kubernetes' {
    start_kubernetes
    wait_for_kubelet
}

@test 'add a search domain to the VM resolv.conf' {
    # Stand in for a search domain from the host network's DHCP lease, and
    # restart k3s so it reads the changed file.
    # shellcheck disable=SC2016 # sed's last-line address, not a variable
    rdsudo sed -i -e '/^search /d' -e '$a search rd-bats.invalid' /etc/resolv.conf
    service_control k3s restart
    wait_for_kubelet
}

@test 'pods do not inherit the VM search domains' {
    kubectl run dns-search --image="${IMAGE_BUSYBOX}" --restart=Never -- sleep 3600
    kubectl wait --for=condition=Ready --timeout=5m pod/dns-search
    run -0 kubectl exec dns-search -- cat /etc/resolv.conf
    assert_line 'search default.svc.cluster.local svc.cluster.local cluster.local'
}
