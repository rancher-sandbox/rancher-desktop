wait_for_apiserver() {
    while true; do
        until $KUBECTL get --raw /readyz &> /dev/null; do sleep 1; done
        sleep 1
        run $KUBECTL get node -o jsonpath="{.items[0].status.nodeInfo.kubeletVersion}"
        if [ $status -eq 0 ]; then
            # Turn "v1.23.4+k3s1" into "1.23.4"
            version=${output#v}
            version=${version%+*}
            [ "$version" == "$1" ] && return 0
        fi
        sleep 1
    done
}
