load '../helpers/load'

local_setup() {
    if is_windows && ! using_windows_exe; then
        # BUG BUG BUG not yet implemented
        skip "Test does not yet work from inside a WSL distro, since it requires WSL integration"
    fi
    needs_port 80
}

assert_traefik_pods_are_down() {
    local traefik_pods pods count
    run --separate-stderr kubectl get --all-namespaces --output 'jsonpath={.items}' pods
    assert_success

    # There should be at least one pod (e.g. coredns, metrics server, ...)
    if [[ "$(jq_output length)" -eq 0 ]]; then
        trace "No pods found"
        return 1
    fi

    # Filter for traefik related pods
    traefik_pods=$(jq_output 'map(select(.metadata.name | contains("traefik")))')

    # Exclude pods that are completed (i.e. jobs)
    pods=$(output=$traefik_pods jq_output 'map(select(.status.conditions | all(.reason != "PodCompleted")))')

    count="$(output=$pods jq_output length)"
    if [[ $count -gt 0 ]]; then
        trace "Found $count active traefik pods"
        return 1
    fi

    trace "No active traefik pods"
    return 0
}

assert_traefik_pods_are_up() {
    ip_regex="^([0-9]{1,3}\.){3}[0-9]{1,3}$"
    run kubectl -n kube-system get service traefik -o jsonpath="{.status.loadBalancer.ingress[0].ip}"
    [[ $output =~ $ip_regex ]]
}

assert_curl() {
    try --max 30 --delay 10 curl --silent --head "$@"
    assert_success
    assert_output --regexp 'HTTP/[0-9.]* 404'
}

refute_curl() {
    run curl --head "$@"
    assert_output --partial "curl: (7) Failed to connect"
}

assert_traefik() {
    assert_curl "http://$1:80"
    assert_curl --insecure "https://$1:443"
}

refute_traefik() {
    refute_curl "http://$1:80"
    refute_curl --insecure "https://$1:443"
}

assert_traefik_on_localhost() {
    if is_windows && ! using_windows_exe; then
        # BUG BUG BUG not yet implemented
        skip "Test does not yet work from inside a WSL distro"
    fi
    try --max 10 assert_traefik localhost
}

@test 'factory reset' {
    factory_reset
}

@test 'start k8s' {
    start_kubernetes --kubernetes.options.traefik=true
    wait_for_kubelet
}

@test 'disable traefik' {
    # First check whether the traefik pods are up from the first launch
    try --max 30 --delay 10 assert_traefik_pods_are_up

    local k3s_pid
    k3s_pid=$(get_service_pid k3s)

    trace "Disable traefik"
    rdctl set --kubernetes.options.traefik=false

    trace "Wait until k3s has restarted"
    try --max 30 --delay 5 refute_service_pid k3s "${k3s_pid}"
    wait_for_kubelet

    trace "Check if the traefik pods go down"
    try --max 30 --delay 10 assert_traefik_pods_are_down
}

@test 'no connection on localhost' {
    try --max 10 refute_traefik localhost
}

@test 'no connection on host-ip' {
    skip_unless_host_ip
    try --max 10 refute_traefik "$HOST_IP"
}

@test 'enable traefik' {
    local k3s_pid
    k3s_pid=$(get_service_pid k3s)

    trace "Enable traefik"
    rdctl set --kubernetes.options.traefik

    trace "Wait until k3s has restarted"
    try --max 30 --delay 5 refute_service_pid k3s "${k3s_pid}"
    wait_for_kubelet

    trace "Check if the traefik pods come up"
    try --max 30 --delay 10 assert_traefik_pods_are_up
}

@test 'curl traefik via localhost' {
    assert_traefik_on_localhost
}

@test 'curl traefik via host-ip while kubernetes.ingress.localhost-only is false' {
    skip_unless_host_ip
    try --max 10 assert_traefik "$HOST_IP"
}

@test 'set kubernetes.ingress.localhost-only to true' {
    skip_unless_host_ip
    if ! is_windows; then
        skip "kubernetes.ingress.localhost-only is a Windows-only setting"
    fi
    rdctl set --kubernetes.options.traefik --kubernetes.ingress.localhost-only
    wait_for_kubelet
    # Check if the traefik pods come up
    try --max 30 --delay 10 assert_traefik_pods_are_up
}

@test 'curl traefik via localhost while kubernetes.ingress.localhost-only is true' {
    if ! is_windows; then
        skip "Test requires kubernetes.ingress.localhost-only to be true"
    fi
    assert_traefik_on_localhost
}

@test 'curl traefik via host-ip while kubernetes.ingress.localhost-only is true' {
    if ! is_windows; then
        skip "Test requires kubernetes.ingress.localhost-only to be true"
    fi
    skip_unless_host_ip

    # traefik should not be accessible on other interface
    try --max 10 refute_traefik "$HOST_IP"
}
