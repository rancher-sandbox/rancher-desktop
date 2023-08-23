# shellcheck disable=SC2030,SC2031
# See https://github.com/koalaman/shellcheck/issues/2431
# https://www.shellcheck.net/wiki/SC2030 -- Modification of output is local (to subshell caused by @bats test)
# https://www.shellcheck.net/wiki/SC2031 -- output was modified in a subshell. That change might be lost

# Test case 25 & 26

load '../helpers/load'

local_setup() {
    if using_networking_tunnel && ! using_windows_exe; then
        # BUG BUG BUG not yet implemented
        skip "Test does not yet work from inside a WSL distro when using networking tunnel, since it requires WSL integration"
    fi
    needs_port 80
}

assert_traefik_pods_are_down() {
    run kubectl get --all-namespaces pods

    if [[ $output != *"connection refused"* ]] &&
        [[ $output != *"No resources found"* ]] &&
        [[ $output != *"ContainerCreating"* ]] &&
        [[ $output != *"Pending"* ]] &&
        [[ $output != *"Completed"* ]] &&
        [[ $output != *"Terminating"* ]] &&
        [[ $output != *"traefik"* ]]; then
        return 0
    else
        return 1
    fi
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
    if using_networking_tunnel && ! using_windows_exe; then
        # BUG BUG BUG not yet implemented
        skip "Test does not yet work from inside a WSL distro when using networking tunnel"
    fi
    assert_traefik localhost
}

@test 'factory reset' {
    factory_reset
}

@test 'start k8s' {
    start_kubernetes --kubernetes.options.traefik=true
    wait_for_apiserver
}

@test 'disable traefik' {
    # First check whether the traefik pods are up from the first launch
    try --max 30 --delay 10 assert_traefik_pods_are_up

    local k3s_pid
    k3s_pid=$(get_service_pid k3s)

    # Disable traefik
    rdctl set --kubernetes.options.traefik=false

    # Wait until k3s has restarted
    try --max 30 --delay 5 refute_service_pid k3s "${k3s_pid}"

    wait_for_apiserver
    # Check if the traefik pods go down
    try --max 30 --delay 10 assert_traefik_pods_are_down
}

@test 'no connection on localhost' {
    refute_traefik localhost
}

@test 'no connection on host-ip' {
    skip_unless_host_ip
    refute_traefik "$HOST_IP"
}

@test 'enable traefik' {
    local k3s_pid
    k3s_pid=$(get_service_pid k3s)

    # Enable traefik
    rdctl set --kubernetes.options.traefik

    # Wait until k3s has restarted
    try --max 30 --delay 5 refute_service_pid k3s "${k3s_pid}"

    wait_for_apiserver
    # Check if the traefik pods come up
    try --max 30 --delay 10 assert_traefik_pods_are_up
}

@test 'curl traefik via localhost' {
    assert_traefik_on_localhost
}

@test 'curl traefik via host-ip while kubernetes.ingress.localhost-only is false' {
    skip_unless_host_ip
    assert_traefik "$HOST_IP"
}

@test 'set kubernetes.ingress.localhost-only to true' {
    skip_unless_host_ip
    if ! is_windows; then
        skip "kubernetes.ingress.localhost-only is a Windows-only setting"
    fi
    rdctl set --kubernetes.options.traefik --kubernetes.ingress.localhost-only
    wait_for_apiserver
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
    refute_traefik "$HOST_IP"
}
