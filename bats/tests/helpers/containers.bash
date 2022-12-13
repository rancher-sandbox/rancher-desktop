wait_for_container_runtime() {
    if [ "$RD_CONTAINER_RUNTIME" != "containerd" ]; then
        until $DOCKER_EXE context ls -q | grep -q ^rancher-desktop$; do
            sleep 3
        done
    fi
    try --max 12 --delay 10 $CRCTL info
}
