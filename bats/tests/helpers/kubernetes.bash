wait_for_apiserver() {
    local desired_version="${1:-$RD_KUBERNETES_PREV_VERSION}"
    local timeout="$(($(date +%s) + 10 * 60))"
    while true; do
        until kubectl get --raw /readyz &>/dev/null; do
            assert [ "$(date +%s)" -lt "$timeout" ]
            sleep 1
        done
        assert [ "$(date +%s)" -lt "$timeout" ]
        run kubectl get node -o jsonpath="{.items[0].status.nodeInfo.kubeletVersion}"
        if ((status == 0)); then
            # Turn "v1.23.4+k3s1" into "1.23.4"
            local version=${output#v}
            version=${version%+*}
            if [ "$version" == "$desired_version" ]; then
                return 0
            fi
        fi
        sleep 1
    done
}
