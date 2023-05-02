# shellcheck disable=SC2030,SC2031
# See https://github.com/koalaman/shellcheck/issues/2431
# https://www.shellcheck.net/wiki/SC2030 -- Modification of output is local (to subshell caused by @bats test)
# https://www.shellcheck.net/wiki/SC2031 -- output was modified in a subshell. That change might be lost

# Test case 25 & 26

load '../helpers/load'

@test 'factory reset' {
    factory_reset
}

@test 'start k8s' {
    start_kubernetes --kubernetes.options.traefik=true
    wait_for_apiserver
}

get_host() {
    if is_windows; then
        echo "127.0.0.1"
    else
        echo "localhost"
    fi
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
    run kubectl get --all-namespaces pods

    if [[ $output != *"connection refused"* ]] &&
        [[ $output != *"No resources found"* ]] &&
        [[ $output != *"ContainerCreating"* ]] &&
        [[ $output != *"Pending"* ]] &&
        [[ $output != *"Terminating"* ]] &&
        [[ $output =~ "traefik" ]]; then
        return 0
    else
        return 1
    fi
}

@test 'disable traefik' {
    # First check whether the traefik pods are up from the first launch
    try --max 30 --delay 10 assert_traefik_pods_are_up
    assert_success
    # Disable traefik
    rdctl set --kubernetes.options.traefik=FALSE
    wait_for_apiserver
    # Check if the traefik pods go down
    try --max 30 --delay 10 assert_traefik_pods_are_down
    assert_success
}

@test 'enable traefik' {
    # Enable traefik
    rdctl set --kubernetes.options.traefik=TRUE
    wait_for_apiserver
    # Check if the traefik pods come up
    try --max 30 --delay 10 assert_traefik_pods_are_up
    assert_success
    try --max 30 --delay 10 curl --head "http://$(get_host):80"
    assert_success
    assert_output --regexp 'HTTP/[0-9.]* 404'
    try --max 30 --delay 10 curl --head --insecure "https://$(get_host):443"
    assert_success
    assert_output --regexp 'HTTP/[0-9.]* 404'
}
