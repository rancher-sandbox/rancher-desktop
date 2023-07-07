# Test case 8, 13, 22

load '../helpers/load'

@test 'factory reset' {
    factory_reset
}

verify_k8s_is_running() {
    wait_for_container_engine
    wait_for_service_status k3s started
}

@test 'start rancher desktop with kubernetes enabled' {
    start_kubernetes
    wait_for_apiserver
    verify_k8s_is_running
}

@test 'disable kubernetes' {
    rdctl set --kubernetes-enabled=false
    wait_for_container_engine
    wait_for_service_status k3s stopped
}

@test 're-enable kubernetes' {
    rdctl set --kubernetes-enabled=true
    wait_for_apiserver
    verify_k8s_is_running
}
