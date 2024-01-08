wait_for_kubelet() {
    local desired_version="${1:-$RD_KUBERNETES_PREV_VERSION}"
    local timeout="$(($(date +%s) + 10 * 60))"
    while true; do
        until kubectl get --raw /readyz &>/dev/null; do
            assert [ "$(date +%s)" -lt "$timeout" ]
            sleep 1
        done
        assert [ "$(date +%s)" -lt "$timeout" ]

        # Check that kubelet is Ready
        run kubectl get node -o jsonpath="{.items[0].status.conditions[?(@.type=='Ready')].status}"
        if ((status == 0)) && [[ $output == "True" ]]; then
            # Verify kubelet version
            run kubectl get node -o jsonpath="{.items[0].status.nodeInfo.kubeletVersion}"
            if ((status == 0)); then
                # Turn "v1.23.4+k3s1" into "1.23.4"
                local version=${output#v}
                version=${version%+*}
                if [ "$version" == "$desired_version" ]; then
                    return 0
                fi
            fi
        fi
        sleep 1
    done
}
