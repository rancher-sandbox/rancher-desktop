load '../helpers/load'

local_setup() {
    if using_docker; then
        skip "this test only works on containerd right now"
    fi
}

assert_traefik_crd_established() {
    local jsonpath="{.status.conditions[?(@.type=='Established')].status}"
    run kubectl get crd traefikservices.traefik.containo.us -o jsonpath="$jsonpath"
    assert_success || return
    assert_output 'True'
}

@test 'start k8s without wasm support' {
    factory_reset
    start_kubernetes
    wait_for_kubelet

    # The manifests in /var/lib/rancher/k3s/server/manifests are processed
    # in alphabetical order. So when traefik.yaml has been loaded we know that
    # rd-runtime.yaml has already been processed.
    try assert_traefik_crd_established
}

@test 'verify no runtimeclasses have been defined' {
    run kubectl get runtimeclasses -o json
    assert_success

    run jq_output '.items | length'
    assert_success
    assert_output 0
}

@test 'start k8s with wasm support' {
    # TODO We should enable the wasm feature on a running app to make sure the
    # TODO runtime class is defined even after k3s is initially installed.
    factory_reset
    start_kubernetes --experimental.container-engine.web-assembly.enabled
    wait_for_kubelet
    try assert_traefik_crd_established
}

@test 'verify spin runtime class has been defined (and no others)' {
    run kubectl get runtimeclasses -o json
    assert_success

    rtc=$output
    run jq -r '.items | length' <<<"$rtc"
    assert_success
    assert_output 1

    run jq -r '.items[0].metadata.name' <<<"$rtc"
    assert_success
    assert_output 'spin'
}

@test 'deploy sample app' {
    kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hello-spin
spec:
  replicas: 1
  selector:
    matchLabels:
      app: hello-spin
  template:
    metadata:
      labels:
        app: hello-spin
    spec:
      runtimeClassName: spin
      containers:
      - name: hello-spin
        image: ghcr.io/deislabs/containerd-wasm-shims/examples/spin-rust-hello:v0.10.0
        command: ["/"]
EOF
}

get_host() {
    if is_windows; then
        local LB_IP
        LB_IP=$(kubectl get svc traefik --namespace kube-system | awk 'NR==2{print $4}')
        echo "$LB_IP.sslip.io"
    else
        echo "localhost"
    fi
}

@test 'deploy ingress' {
    kubectl apply -f - <<EOF
apiVersion: v1
kind: Service
metadata:
  name: hello-spin
spec:
  type: ClusterIP
  selector:
    app: hello-spin
  ports:
  - port: 80
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: hello-spin
  annotations:
    traefik.ingress.kubernetes.io/router.entrypoints: web
spec:
  rules:
  - host: $(get_host)
    http:
      paths:
        - path: /
          pathType: Prefix
          backend:
            service:
              name: hello-spin
              port:
                number: 80
EOF
}

@test 'connect to the service' {
    # TODO Why does it take about 100s before the service is ready?
    run try curl --silent --fail "http://$(get_host)/hello"
    assert_success
    assert_output "Hello world from Spin!"
}
