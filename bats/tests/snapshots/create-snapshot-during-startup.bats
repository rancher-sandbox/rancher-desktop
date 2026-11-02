load '../helpers/load'

local_setup() {
    CONTAINERD_NAMESPACE=rancher-desktop-extensions
    SNAPSHOT=the-hasty-flounder
}

@test 'factory reset and delete all the snapshots' {
    delete_all_snapshots
    factory_reset
}

@test 'start the container engine' {
    start_container_engine
    wait_for_shell
}

# Rancher Desktop must keep running when a stop interrupts the extension
# manager's proxy image load. The load starts as soon as the backend is ready,
# and creating a snapshot stops the backend, so this test polls without a delay
# to create the snapshot during the load. The load can still finish first, and
# the test then passes without exercising the interruption.
@test 'create a snapshot as soon as the backend is ready' {
    try --max 6000 --delay 0 assert_backend_available
    rdctl snapshot create "${SNAPSHOT}"
}

@test 'the next start loads the proxy image' {
    wait_for_backend
    try --max 12 --delay 5 ctrctl image inspect ghcr.io/rancher-sandbox/rancher-desktop/rdx-proxy:latest
}
