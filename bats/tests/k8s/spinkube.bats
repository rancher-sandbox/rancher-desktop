load '../helpers/load'

local_setup() {
    if using_docker; then
        skip "this test only works on containerd right now"
    fi
    needs_port 80
}

@test 'start k8s with spinkube' {
    factory_reset
    start_kubernetes \
        --experimental.container-engine.web-assembly.enabled \
        --experimental.kubernetes.options.spinkube
    wait_for_kubelet
    wait_for_traefik
}

@test 'wait for spinkube operator' {
    wait_for_kube_deployment_available --namespace spin-operator spin-operator-controller-manager
}

@test 'deploy app to kubernetes' {
    # Newer versions of the sample app have moved from "deislabs" to "spinkube":
    # ghcr.io/spinkube/containerd-shim-spin/examples/spin-rust-hello:v0.13.0
    spin kube deploy --from ghcr.io/deislabs/containerd-wasm-shims/examples/spin-rust-hello:v0.10.0
}

# TODO replace ingress with port-forwarding
@test 'deploy ingress' {
    # TODO remove `skip_unless_host_ip` once `traefik_hostname` no longer needs it
    if is_windows; then
        skip_unless_host_ip
    fi

    local host
    host=$(traefik_hostname)

    kubectl apply --filename - <<EOF
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: spin-rust-hello
  annotations:
    traefik.ingress.kubernetes.io/router.entrypoints: web
spec:
  rules:
  - host: "${host}"
    http:
      paths:
        - path: /
          pathType: Prefix
          backend:
            service:
              name: spin-rust-hello
              port:
                number: 80
EOF
}

@test 'connect to app on localhost' {
    # TODO remove `skip_unless_host_ip` once `traefik_hostname` no longer needs it
    if is_windows; then
        skip_unless_host_ip
    fi

    local host
    host=$(traefik_hostname)

    run --separate-stderr try curl --connect-timeout 5 --fail "http://${host}/hello"
    assert_success
    assert_output "Hello world from Spin!"
}

@test 'disable spinkube and traefik' {
    local k3s_pid
    k3s_pid=$(get_service_pid k3s)

    trace "Disable spinkube operator and traefik"
    rdctl set \
        --experimental.kubernetes.options.spinkube=false \
        --kubernetes.options.traefik=false

    trace "Wait until k3s has restarted"
    try --max 30 --delay 5 refute_service_pid k3s "${k3s_pid}"
    wait_for_kubelet
}

assert_helm_charts_are_deleted() {
    run --separate-stderr kubectl get helmcharts --namespace kube-system
    assert_success
    refute_line traefik
    refute_line spin-operator
    refute_line cert-manager
}

@test 'verify that spinkube and traefik have been uninstalled' {
    try assert_helm_charts_are_deleted
}
