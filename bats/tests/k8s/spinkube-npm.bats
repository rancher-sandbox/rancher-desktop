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

@test 'start k8s with spinkube' {
    factory_reset
    start_kubernetes \
        --experimental.container-engine.web-assembly.enabled \
        --experimental.kubernetes.options.spinkube
    wait_for_kubelet
    wait_for_traefik
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
  name: "${MY_APP_NAME}"
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
              name: "${MY_APP_NAME}"
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

    run --separate-stderr try curl --connect-timeout 5 --fail "http://${host}"
    assert_success
    assert_output --regexp '^(Hello|hello)'
}
