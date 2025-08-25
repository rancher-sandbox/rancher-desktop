load '../helpers/load'

local_setup() {
    if using_docker; then
        skip "this test only works on containerd right now"
    fi
}

# Get Kubernetes RuntimeClasses; sets $output to the JSON list.
get_runtime_classes() {
    # kubectl may emit warnings here; ensure that we don't fall over.
    run --separate-stderr kubectl get RuntimeClasses --output json
    assert_success

    if [[ -n $stderr ]]; then
        # Check that we got a deprecation warning:
        # Warning: node.k8s.io/v1beta1 RuntimeClass is deprecated in v1.22+, unavailable in v1.25+
        output=$stderr assert_output --partial deprecated
    fi

    local rtc=$output
    run jq '.items | length' <<<"$rtc"
    assert_success
    ((output > 0))
    echo "$rtc"
}

create_bats_runtimeclass() {
    provisioning_script <<EOF
mkdir -p /var/lib/rancher/k3s/server/manifests
cat <<YAML >/var/lib/rancher/k3s/server/manifests/zzzz-bats.yaml
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: bats
handler: bats
YAML
EOF
}

@test 'start k8s without wasm support' {
    factory_reset
    create_bats_runtimeclass
    start_kubernetes
    wait_for_kubelet
}

@test 'verify no runtimeclasses have been defined' {
    run try get_runtime_classes
    assert_success

    run jq_output --raw-output '.items[0].metadata.name'
    assert_success
    assert_output 'bats'
}

@test 'start k8s with wasm support' {
    # TODO We should enable the wasm feature on a running app to make sure the
    # TODO runtime class is defined even after k3s is initially installed.
    factory_reset
    create_bats_runtimeclass
    start_kubernetes --experimental.container-engine.web-assembly.enabled
    wait_for_kubelet
    wait_for_traefik
}

@test 'verify spin runtime class has been defined (and no others)' {
    run try get_runtime_classes
    assert_success

    rtc=$output
    run jq '.items | length' <<<"$rtc"
    assert_success
    assert_output 2

    run jq --raw-output '.items[].metadata.name' <<<"$rtc"
    assert_success
    assert_line 'bats'
    assert_line 'spin'
}

@test 'deploy sample app' {
    kubectl apply --filename - <<EOF
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
        # Newer versions of the sample app have moved from "deislabs" to "spinkube":
        # ghcr.io/spinkube/containerd-shim-spin/examples/spin-rust-hello:v0.13.0
        image: ghcr.io/deislabs/containerd-wasm-shims/examples/spin-rust-hello:v0.10.0
        command: ["/"]
EOF
}

@test 'deploy ingress' {
    # TODO remove `skip_unless_host_ip` once `traefik_hostname` no longer needs it
    if is_windows; then
        skip_unless_host_ip
    fi

    local host
    host=$(traefik_hostname)

    kubectl apply --filename - <<EOF
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
  - host: "$host"
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
    # TODO remove `skip_unless_host_ip` once `traefik_hostname` no longer needs it
    if is_windows; then
        skip_unless_host_ip
    fi

    local host
    host=$(traefik_hostname)

    # This can take 100s with old versions of traefik, and 15s with newer ones.
    run try curl --silent --fail "http://${host}/hello"
    assert_success
    assert_output "Hello world from Spin!"
}
