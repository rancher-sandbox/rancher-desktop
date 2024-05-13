load '../helpers/load'

local_setup() {
    if using_docker; then
        skip "this test only works on containerd right now"
    fi
}

# Get the host name to use to reach Traefik
get_host() {
    if is_windows; then
        local jsonpath='jsonpath={.status.loadBalancer.ingress[0].ip}'
        run --separate-stderr kubectl get service traefik --namespace kube-system --output "$jsonpath"
        assert_success || return
        assert_output || return
        echo "${output}.sslip.io"
    else
        echo "localhost"
    fi
}

@test 'start k8s with spinkube' {
    factory_reset
    start_kubernetes \
        --experimental.container-engine.web-assembly.enabled \
        --experimental.kubernetes.options.spinkube
    wait_for_kubelet
}

@test 'wait for spinkube operator' {
    wait_for_kube_deployment_available --namespace spin-operator spin-operator-controller-manager
}

@test 'deploy app to kubernetes' {
    spin kube deploy --from ghcr.io/deislabs/containerd-wasm-shims/examples/spin-rust-hello:v0.10.0
}

# TODO replace ingress with port-forwarding
@test 'deploy ingress' {
    kubectl apply --filename - <<EOF
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: spin-rust-hello
  annotations:
    traefik.ingress.kubernetes.io/router.entrypoints: web
spec:
  rules:
  - host: "$(get_host)"
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
    run --separate-stderr try curl --connect-timeout 5 --fail "http://$(get_host)/hello"
    assert_success
    assert_output "Hello world from Spin!"
}
