load '../helpers/load'

# This file will not run **any** test unless RD_K3S_VERSIONS is set

start_and_wait_for_kubelet() {
    factory_reset
    start_kubernetes
    wait_for_kubelet
}

foreach_k3s_version start_and_wait_for_kubelet
