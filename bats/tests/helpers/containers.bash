wait_for_container_runtime() {
    try --max 12 --delay 10 $CRCTL info
}
