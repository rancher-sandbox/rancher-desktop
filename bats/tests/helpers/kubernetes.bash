wait_for_kubelet() {
    local desired_version=${1:-$RD_KUBERNETES_VERSION}
    local timeout=$(($(date +%s) + RD_KUBELET_TIMEOUT * 60))
    trace "waiting for Kubernetes ${desired_version} to be available"
    while true; do
        sleep 1
        assert [ "$(date +%s)" -lt "$timeout" ]
        if ! kubectl get --raw /readyz &>/dev/null; then
            continue
        fi

        # Check that kubelet is Ready
        run kubectl get node -o jsonpath="{.items[0].status.conditions[?(@.type=='Ready')].status}"
        if ((status != 0)) || [[ $output != "True" ]]; then
            continue
        fi

        # Make sure the "default" serviceaccount exists
        if ! kubectl get --namespace default serviceaccount default &>/dev/null; then
            continue
        fi

        # Get kubelet version
        run kubectl get node -o jsonpath="{.items[0].status.nodeInfo.kubeletVersion}"
        if ((status != 0)); then
            continue
        fi

        # Turn "v1.23.4+k3s1" into "1.23.4"
        local version=${output#v}
        version=${version%+*}
        if [ "$version" == "$desired_version" ]; then
            return 0
        fi
    done
}

# unwrap_kube_list removes the "List" wrapper from the JSON in $output if .kind is "List".
# Returns an error if the number of .items in the List isn't exactly 1.
unwrap_kube_list() {
    local json=$output

    run jq_output '.kind'
    assert_success
    if [[ $output == "List" ]]; then
        run jq --raw-output '.items | length' <<<"$json"
        assert_success
        assert_output "1"

        run jq --raw-output '.items[0]' <<<"$json"
        assert_success
        json=$output
    fi
    echo "$json"
}

assert_kube_deployment_available() {
    local jsonpath="jsonpath={.status.conditions[?(@.type=='Available')].status}"
    run --separate-stderr kubectl get deployment "$@" --output "$jsonpath"
    assert_success
    assert_output "True"
}

# Save the cluster state next to a failing test's logs.  k3s.log holds only
# the kubelet's view of an unhealthy pod ("back-off 5m0s restarting failed
# container"), never what the container printed before it died.
capture_kubernetes_state() {
    local logdir="$1/kubernetes"
    local namespace pod container previous

    # Many suites run with Kubernetes turned off, and a wedged apiserver must
    # not hold up the capture, so ask /livez once with a short timeout; /readyz
    # fails while any readiness check does, which is when the capture matters.
    if ! kubectl --request-timeout=10s get --raw /livez &>/dev/null; then
        return
    fi

    mkdir -p "$logdir"
    kubectl --request-timeout=30s get pods --all-namespaces --output wide \
        >"$logdir/pods.txt" 2>&1 || :
    kubectl --request-timeout=30s get events --all-namespaces \
        --sort-by=.metadata.creationTimestamp \
        >"$logdir/events.txt" 2>&1 || :
    kubectl --request-timeout=30s get pods --all-namespaces --output json \
        >"$logdir/pods.json" 2>"$logdir/pods.err" || :
    if [[ ! -s $logdir/pods.err ]]; then
        rm -f "$logdir/pods.err"
    fi
    kubectl --request-timeout=30s get all --all-namespaces \
        >"$logdir/all.txt" 2>&1 || :
    # helm keeps every release as a secret labelled with its name and status,
    # which says whether an uninstall ran at all.  k3s deletes the Job that
    # would have logged it as soon as the chart is gone, so by the time a test
    # gives up there is often nothing else left to ask.
    kubectl --request-timeout=30s get secrets --all-namespaces \
        --selector owner=helm --show-labels \
        >"$logdir/helm-releases.txt" 2>&1 || :

    # Log only the containers that are unhealthy, init containers included, so
    # that a healthy pod does not add a file beyond the summaries above.  A
    # finished Job container is also "not ready", hence the exit code test.
    # helm-* pods get logged after exit 0 too, because their Job exits 0 even
    # when the chart's workload outlives the uninstall, and only its log says
    # what helm did.
    while read -r namespace pod container; do
        kubectl --request-timeout=30s logs --namespace "$namespace" "$pod" \
            --container "$container" --tail=200 \
            >"$logdir/${namespace}_${pod}_${container}.log" 2>&1 || :
        # A container that has never restarted has no previous instance, and
        # the error kubectl prints for that is not worth keeping.
        previous="$logdir/${namespace}_${pod}_${container}.previous.log"
        if ! kubectl --request-timeout=30s logs --namespace "$namespace" "$pod" \
            --container "$container" --tail=200 --previous >"$previous" 2>&1; then
            rm -f "$previous"
        fi
    done < <(jq --raw-output '
        .items[] | . as $pod
        | (($pod.status.initContainerStatuses // [])
           + ($pod.status.containerStatuses // []))[]
        | select(.ready | not)
        | select(($pod.metadata.name | startswith("helm-"))
                 or ((.state.terminated.exitCode // 1) != 0))
        | "\($pod.metadata.namespace) \($pod.metadata.name) \(.name)"
    ' "$logdir/pods.json" 2>/dev/null)
}

wait_for_kube_deployment_available() {
    trace "waiting for deployment $*"
    try assert_kube_deployment_available "$@"
}

assert_pod_containers_are_running() {
    run kubectl get pod "$@" --output json
    assert_success

    # Make sure the query returned just a single pod
    run unwrap_kube_list
    assert_success

    # Confirm that **all** containers of the pod are in "running" state
    run jq_output '[.status.containerStatuses[].state | keys] | add | unique | .[]'
    assert_success
    assert_output "running"
}

traefik_ip() {
    local jsonpath='jsonpath={.status.loadBalancer.ingress[0].ip}'
    run --separate-stderr kubectl get service traefik --namespace kube-system --output "$jsonpath"
    assert_success
    assert_output
    echo "$output"
}

traefik_hostname() {
    if is_windows; then
        # BUG BUG BUG
        # Currently the service ip address is not routable from the host
        # https://github.com/rancher-sandbox/rancher-desktop/issues/6934
        # BUG BUG BUG

        # local ip
        # ip=$(traefik_ip)
        # echo "${ip}.sslip.io"

        # caller must have called `skip_unless_host_ip`
        output=$HOST_IP assert_output
        echo "${HOST_IP}.sslip.io"
    else
        echo "localhost"
    fi
}

wait_for_traefik() {
    trace "waiting for the traefik service to get an IP address"
    try traefik_ip
}

get_k3s_versions() {
    if [[ $RD_K3S_VERSIONS == "all" ]]; then
        # filter out duplicates; RD only supports the latest of +k3s1, +k3s2, etc.
        RD_K3S_VERSIONS=$(
            gh api /repos/k3s-io/k3s/releases --paginate --jq '.[].tag_name' |
                grep -E '^v1\.[0-9]+\.[0-9]+\+k3s[0-9]+$' |
                sed -E 's/v([^+]+)\+.*/\1/' |
                sort --unique --version-sort
        )
    fi

    if [[ $RD_K3S_VERSIONS == "latest" ]]; then
        RD_K3S_VERSIONS=$(
            curl --silent --fail https://update.k3s.io/v1-release/channels |
                jq --raw-output '.data[] | select(.name | test("^v[0-9]+\\.[0-9]+$")).latest' |
                sed -E 's/v([^+]+)\+.*/\1/'
        )
    fi
}
