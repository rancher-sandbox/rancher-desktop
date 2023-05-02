# Test case 8, 13, 22

load '../helpers/load'

@test 'factory reset' {
    factory_reset
}

verify_k8s_is_running() {
    wait_for_container_engine
    run rc_service --nocolor k3s status
    assert_line --partial "status: started"
}

@test 'start rancher desktop with kubernetes enabled' {
    start_kubernetes
    wait_for_apiserver
    verify_k8s_is_running
}

@test 'disable kubernetes' {
    rdctl set --kubernetes-enabled=false
    wait_for_container_engine
    echo "Sleeping for 60 seconds before testing to see if k3s is running..." 1>&3
    sleep 60
    # rc-service fails with exit code 3 when the service is not running
    run rc_service --nocolor k3s status
    assert_line --partial "status: stopped"
}

@test 're-enable kubernetes' {
    rdctl set --kubernetes-enabled=true
    wait_for_apiserver
    verify_k8s_is_running
}
