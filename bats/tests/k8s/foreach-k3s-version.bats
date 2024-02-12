load '../helpers/load'

foreach_k3s_version \
    factory_reset \
    start_kubernetes \
    wait_for_kubelet
