wait_for_apiserver() {
    local desired_version="${1:-$RD_KUBERNETES_PREV_VERSION}"
    while true; do
        until kubectl get --raw /readyz &> /dev/null; do sleep 1; done
        sleep 1
        run kubectl get node -o jsonpath="{.items[0].status.nodeInfo.kubeletVersion}"
        if [ $status -eq 0 ]; then
            # Turn "v1.23.4+k3s1" into "1.23.4"
            local version=${output#v}
            version=${version%+*}
            [ "$version" == "$desired_version" ] && return 0
        fi
        sleep 1
    done
}
