wait_for_kubelet() {
    local desired_version=${1:-$RD_KUBERNETES_PREV_VERSION}
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
        if ! kubectl get --namespace default serviceaccount default; then
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
