load '../helpers/load'

wait_for_dns() {
    try assert_pod_containers_are_running \
        --namespace kube-system \
        --selector k8s-app=kube-dns
}

foreach_k3s_version \
    factory_reset \
    start_kubernetes \
    wait_for_kubelet \
    wait_for_dns
