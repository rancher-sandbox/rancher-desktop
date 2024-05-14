load '../helpers/load'

local_setup_file() {
    echo "$RANDOM" >"${BATS_FILE_TMPDIR}/random"
}

local_setup() {
    if using_docker; then
        skip "this test only works on containerd right now"
    fi
    if ! command -v "npm${EXE}" >/dev/null; then
        skip "this test requires npm${EXE} to be installed and on the PATH"
    fi
    needs_port 80

    MY_APP=my-app
    MY_APP_NAME="${MY_APP}-$(cat "${BATS_FILE_TMPDIR}/random")"
    MY_APP_IMAGE="ttl.sh/${MY_APP_NAME}:15m"
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

@test 'create sample application' {
    cd "$BATS_FILE_TMPDIR"
    spin new --accept-defaults --template http-js "$MY_APP"
    cd "$MY_APP"
    "npm${EXE}" install
    spin build
    spin registry push "$MY_APP_IMAGE"
}

@test 'wait for spinkube operator' {
    wait_for_kube_deployment_available --namespace spin-operator spin-operator-controller-manager
}

@test 'deploy app to kubernetes' {
    spin kube deploy --from "$MY_APP_IMAGE"
}

# TODO replace ingress with port-forwarding
@test 'deploy ingress' {
    kubectl apply --filename - <<EOF
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: "${MY_APP_NAME}"
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
              name: "${MY_APP_NAME}"
              port:
                number: 80
EOF
}

@test 'connect to app on localhost' {
    run --separate-stderr try curl --connect-timeout 5 --fail "http://$(get_host)"
    assert_success
    assert_output "Hello from JS-SDK"
}
